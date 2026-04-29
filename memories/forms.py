from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm

from .models import Memoir


class RegisterForm(UserCreationForm):
    email = forms.EmailField(
        label="邮箱",
        required=False,
        widget=forms.EmailInput(attrs={"placeholder": "可选"}),
    )

    class Meta:
        model = get_user_model()
        fields = ("username", "email", "password1", "password2")
        widgets = {
            "username": forms.TextInput(attrs={"placeholder": "设置登录用户名"}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"].label = "用户名"
        self.fields["password1"].label = "密码"
        self.fields["password2"].label = "确认密码"
        self.fields["password1"].widget.attrs.update({"placeholder": "设置密码"})
        self.fields["password2"].widget.attrs.update({"placeholder": "再次输入密码"})


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
