from pathlib import Path

from django.core.files import File
from django.core.management.base import BaseCommand, CommandError

from surveillance import detection
from surveillance.models import Video


class Command(BaseCommand):
    help = (
        "Run detection synchronously, so errors show in the terminal.\n"
        "  Existing video:  python manage.py process_video <id>\n"
        "  Local file:      python manage.py process_video --file clip.mp4 --room A101 "
        "[--zone 0,60,30,100]"
    )

    def add_arguments(self, parser):
        parser.add_argument("video_id", type=int, nargs="?")
        parser.add_argument("--file", help="Import a local video file as a new Video first")
        parser.add_argument("--room", default="Test")
        parser.add_argument("--exam-name", default="")
        parser.add_argument("--zone", help="Restricted zone as left,top,right,bottom percentages")

    def handle(self, *args, **options):
        if options["file"]:
            video = self._import_file(options)
        elif options["video_id"]:
            video = Video.objects.filter(id=options["video_id"]).first()
            if video is None:
                raise CommandError(f"Video with id {options['video_id']} does not exist.")
        else:
            raise CommandError("Give a video id or --file.")

        self.stdout.write(f"Processing video {video.id}...")
        detection.process_video(video.id)
        video.refresh_from_db()
        self.stdout.write(self.style.SUCCESS(
            f"Finished video {video.id}: {video.frames_processed} frames analysed, "
            f"{video.flags.count()} flags."
        ))
        for flag in video.flags.all():
            self.stdout.write(
                f"  {flag.start_display}-{flag.end_display}  {flag.get_flag_type_display():<22} "
                f"{flag.subject_display:<12} conf {flag.confidence:.2f} (peak {flag.peak_confidence:.2f})"
            )

    def _import_file(self, options):
        path = Path(options["file"])
        if not path.is_file():
            raise CommandError(f"File not found: {path}")
        zone = {}
        if options["zone"]:
            try:
                x1, y1, x2, y2 = (float(v) for v in options["zone"].split(","))
            except ValueError:
                raise CommandError("--zone must be four numbers: left,top,right,bottom")
            zone = {"zone_x1": x1, "zone_y1": y1, "zone_x2": x2, "zone_y2": y2}
        video = Video(room=options["room"], exam_name=options["exam_name"], **zone)
        with path.open("rb") as fh:
            video.file.save(path.name, File(fh), save=True)
        return video
