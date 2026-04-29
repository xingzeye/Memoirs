from django import forms

from .models import Memoir


class MemoirForm(forms.ModelForm):
    class Meta:
        model = Memoir
        fields = ("title", "memory_date", "location", "mood", "story")
        widgets = {
            "title": forms.TextInput(attrs={"placeholder": "比如：那年冬天的重庆"}),
            "memory_date": forms.DateInput(attrs={"type": "date"}),
            "location": forms.TextInput(attrs={"placeholder": "城市、街角、车站"}),
            "mood": forms.TextInput(attrs={"placeholder": "释怀、遗憾、怀念、告别"}),
            "story": forms.Textarea(attrs={"rows": 8, "placeholder": "写下你想保存的细节。"}),
        }
