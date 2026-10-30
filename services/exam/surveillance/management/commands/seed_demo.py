"""Demo data: the exam "DBMS Mid-sem · Room T1" and the sample clips, analysed one at a time.

Idempotent: an exam or clip that already exists is left alone (clips matched by size).
"""

import os
import shutil
import uuid
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from surveillance import jobs
from surveillance.models import Clip, Exam, Job
from surveillance.views import sniff

SAMPLES = Path(os.environ.get("EXAM_SAMPLES_DIR", "~/Desktop/exam-samples")).expanduser()


class Command(BaseCommand):
    def handle(self, *args, **options):
        exam, _ = Exam.objects.get_or_create(name="DBMS Mid-sem", room="T1")
        files = sorted(SAMPLES.glob("*.mp4")) + sorted(SAMPLES.glob("*.webm")) if SAMPLES.is_dir() else []
        if not files:
            self.stdout.write(f"No sample clips in {SAMPLES}; created the exam only.")
        for path in files:
            kind = sniff(path.open("rb").read(12))
            size = path.stat().st_size
            if not kind or Clip.objects.filter(exam=exam, size_bytes=size).exists():
                continue
            cid = uuid.uuid4()
            rel = f"clips/{cid}.{kind[1]}"
            shutil.copyfile(path, settings.MEDIA_ROOT / rel)
            clip = Clip.objects.create(id=cid, exam=exam, file=rel, content_type=kind[0], size_bytes=size)
            job = Job.objects.create(clip=clip)
            jobs.run(job.id)
            self.stdout.write(f"Processed sample clip {clip.id}")
