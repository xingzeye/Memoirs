from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("memories", "0003_memoir_deleted_at"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="memoir",
            index=models.Index(
                fields=["owner", "deleted_at", "-memory_date", "-created_at"],
                name="memoir_owner_del_date_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="memoir",
            index=models.Index(
                fields=["owner", "deleted_at", "mood"],
                name="memoir_owner_del_mood_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="memoirmedia",
            index=models.Index(
                fields=["memoir", "media_type", "uploaded_at"],
                name="media_memoir_type_time_idx",
            ),
        ),
    ]
