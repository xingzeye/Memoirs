from django.core.management.base import BaseCommand
from django.utils import timezone

from memories.models import MobileUploadSession


class Command(BaseCommand):
    help = "Clean expired mobile upload sessions and their temporary files."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report what would be cleaned.")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        sessions = MobileUploadSession.objects.filter(
            is_consumed=False,
            expires_at__lt=timezone.now(),
        ).prefetch_related("items")

        session_count = 0
        file_count = 0
        for session in sessions.iterator(chunk_size=50):
            session_count += 1
            for item in session.items.all():
                if item.file:
                    file_count += 1
                    if not dry_run:
                        item.file.delete(save=False)
                if not dry_run:
                    item.delete()
            if not dry_run:
                session.is_consumed = True
                session.save(update_fields=["is_consumed"])

        action = "Would clean" if dry_run else "Cleaned"
        self.stdout.write(f"{action} {session_count} mobile upload sessions and {file_count} files.")
