from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("memories", "0002_mobile_upload"),
    ]

    operations = [
        migrations.AddField(
            model_name="memoir",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True, verbose_name="删除时间"),
        ),
    ]
