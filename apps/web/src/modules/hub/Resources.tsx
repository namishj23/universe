import { useEffect, useState, type FormEvent } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { hub } from '@universe/contracts';
import type { z } from 'zod';
import { useUser } from '../../platform/auth';
import { Button } from '../../shell/ui/Button';
import { Chips } from '../../shell/ui/Controls';
import { Field, FormError, Input, Select } from '../../shell/ui/Field';
import { Modal, ModalActions } from '../../shell/ui/Overlay';
import { Empty, ErrorBox, Loading } from '../../shell/ui/States';
import { LoadMore, Row, Table } from '../../shell/ui/Table';
import { useToast } from '../../shell/ui/Toast';
import {
  createResource,
  deleteResource,
  fileUrl,
  getResources,
  getSubjects,
  KEYS,
  message,
  uploadError,
  uploadFile,
} from './api';
import { addedLabel, fileType, HUB_WHAT, sizeLabel } from './text';
import s from './Hub.module.css';

const COLUMNS = 'minmax(0,2fr) 70px minmax(0,1fr) 80px 90px';
const ADMIN_COLUMNS = `${COLUMNS} 80px`;
const MAX_BYTES = 10 * 1024 * 1024;
const TYPE_LABEL: Record<hub.ResourceType, string> = {
  notes: 'Notes',
  question_paper: 'Question paper',
  study_material: 'Study material',
  cheat_sheet: 'Cheat sheet',
};

/** `value`, settled for `ms`: one search request per pause, not per keystroke. */
function useDebounced<T>(value: T, ms = 250) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** Upload the file (type checked from its bytes by the server), then create the resource. */
function UploadModal({
  open,
  onOpenChange,
  subjects,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subjects: z.infer<typeof hub.Subject>[];
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState(subjects[0]?.code ?? '');
  const [type, setType] = useState<hub.ResourceType>('notes');
  const [error, setError] = useState('');
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const record = await uploadFile(f);
      return createResource({ fileId: record.id, title: title.trim(), subject, type });
    },
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'resources'] });
      toast(`Uploaded. Type checked from the file bytes: ${fileType(r.mimeType)}.`);
      setFile(null);
      setTitle('');
      setError('');
      onOpenChange(false);
    },
    onError: (err) => setError(uploadError(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // A courtesy only: the server checks size and type again from the bytes.
    if (!file) return setError('Pick a file.');
    if (file.size > MAX_BYTES) return setError('File is larger than 10 MB.');
    if (title.trim().length < 3) return setError('Give it a title of at least 3 characters.');
    upload.mutate(file);
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Upload a resource">
      <form className={s.stack} onSubmit={submit} noValidate>
        <Field label="FILE · PDF, PNG OR JPEG, UP TO 10 MB">
          <Input
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError('');
            }}
          />
        </Field>
        <Field label="TITLE">
          <Input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className={s.pair}>
          <Field label="SUBJECT">
            <Select value={subject} onChange={(e) => setSubject(e.target.value)}>
              {subjects.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.code} · {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="TYPE">
            <Select value={type} onChange={(e) => setType(hub.ResourceType.parse(e.target.value))}>
              {hub.ResourceType.options.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {error && <FormError>{error}</FormError>}
        <ModalActions>
          <Button variant="secondary" size="modal" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" size="modal" disabled={upload.isPending}>
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

function DeleteModal({ resource, onClose }: { resource: hub.Resource; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: () => deleteResource(resource.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hub', 'resources'] });
      toast(`Deleted "${resource.title}".`);
      onClose();
    },
    onError: (err) => toast(message(err), 'ERROR'),
  });
  return (
    <Modal
      open
      narrow
      onOpenChange={(o) => !o && onClose()}
      title="Delete this resource?"
      description={`"${resource.title}" disappears from the repository for everyone. The audit log keeps a record.`}
    >
      <ModalActions>
        <Button variant="secondary" size="modal" onClick={onClose}>
          Keep it
        </Button>
        <Button
          variant="danger"
          size="modal"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Delete
        </Button>
      </ModalActions>
    </Modal>
  );
}

export function Resources() {
  const isAdmin = useUser().role === 'admin';
  const [q, setQ] = useState('');
  const [subject, setSubject] = useState('All');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<hub.Resource | null>(null);
  const search = useDebounced(q.trim());
  const subjects = useQuery({
    queryKey: KEYS.subjects,
    queryFn: ({ signal }) => getSubjects(signal),
  });
  const resources = useInfiniteQuery({
    queryKey: KEYS.resources(search, subject),
    queryFn: ({ pageParam, signal }) => getResources(search, subject, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });

  if (resources.isPending || subjects.isPending) return <Loading what={HUB_WHAT} />;
  if (resources.isError || subjects.isError) {
    const failed = resources.isError ? resources : subjects;
    return <ErrorBox error={failed.error} what={HUB_WHAT} onRetry={() => void failed.refetch()} />;
  }
  const rows = resources.data.pages.flatMap((p) => p.items);
  const filtered = search !== '' || subject !== 'All';
  const upload = (
    <UploadModal open={uploading} onOpenChange={setUploading} subjects={subjects.data} />
  );
  if (rows.length === 0 && !filtered)
    return (
      <>
        <Empty
          title="No resources yet"
          body="Notes, past papers and cheat sheets shared by students and mentors appear here."
          action={{ label: 'Upload PDF', onClick: () => setUploading(true) }}
        />
        {upload}
      </>
    );
  return (
    <>
      <div className={s.filters}>
        <Input
          className={s.search}
          type="search"
          aria-label="Search titles, subjects, uploaders"
          placeholder="Search titles, subjects, uploaders"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Chips
          label="Filter by subject"
          look="mono"
          tight
          choices={[
            { id: 'All', label: 'All' },
            ...subjects.data.map((x) => ({ id: x.code, label: x.code })),
          ]}
          value={subject}
          onChange={setSubject}
        />
        <Button className={s.upload} onClick={() => setUploading(true)}>
          Upload PDF
        </Button>
      </div>
      <Table
        label="Resources"
        columns={isAdmin ? ADMIN_COLUMNS : COLUMNS}
        rowPad="11px 14px"
        align="baseline"
        minWidth="640px"
        headers={[
          'TITLE',
          'SUBJECT',
          'UPLOADED BY',
          'SIZE',
          'ADDED',
          ...(isAdmin
            ? [
                <span key="a" className="uv-visually-hidden">
                  Actions
                </span>,
              ]
            : []),
        ]}
      >
        {rows.map((r) => (
          <Row key={r.id}>
            <span role="cell">
              {/* Same-origin download: the server sets the type and Content-Disposition. */}
              <a className={s.resTitle} href={fileUrl(r.fileId)}>
                {r.title}
              </a>
              <span className={s.type}>{fileType(r.mimeType)}</span>
            </span>
            <span role="cell" className={s.subject}>
              {r.subject}
            </span>
            <span role="cell" className={s.by}>
              {r.uploader.name}
            </span>
            <span role="cell" className={s.cell}>
              {sizeLabel(r.sizeBytes)}
            </span>
            <span role="cell" className={`${s.cell} ${s.muted}`}>
              {addedLabel(r.createdAt)}
            </span>
            {isAdmin && (
              <span role="cell" style={{ display: 'grid' }}>
                {r.canDelete && !r.deletedAt && (
                  <Button variant="destructive" size="sm" onClick={() => setDeleting(r)}>
                    Delete
                  </Button>
                )}
              </span>
            )}
          </Row>
        ))}
        {rows.length === 0 && (
          <div className={s.noMatch}>
            <span className={s.noMatchTitle}>No resources match &quot;{q.trim()}&quot;</span>
            <span className={s.noMatchBody}>
              Try a subject code like OS or DBMS, or clear the filter.
            </span>
          </div>
        )}
      </Table>
      <LoadMore
        hasMore={resources.hasNextPage}
        loading={resources.isFetchingNextPage}
        onClick={() => void resources.fetchNextPage()}
      />
      {upload}
      {deleting && <DeleteModal resource={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}
