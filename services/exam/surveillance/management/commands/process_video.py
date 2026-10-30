from django.core.management.base import BaseCommand

from surveillance import jobs


class Command(BaseCommand):
    help = "Run one analysis job synchronously: python manage.py process_video <job id>"

    def add_arguments(self, parser):
        parser.add_argument("job_id")

    def handle(self, *args, **options):
        jobs.run(options["job_id"])
