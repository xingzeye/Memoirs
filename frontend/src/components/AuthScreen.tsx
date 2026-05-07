import { Lock, Mail, UserRound } from "lucide-react";
import { useState } from "react";
import { apiJson } from "../lib/api";
import type { AppSession, FormErrors } from "../lib/types";
import { EmptyBrand } from "./Brand";

type AuthScreenProps = {
  session: AppSession;
  payload: Record<string, unknown>;
};

export function AuthScreen({ session, payload }: AuthScreenProps) {
  const initialMode = payload.mode === "register" ? "register" : "login";
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [errors, setErrors] = useState<FormErrors>((payload.errors as FormErrors) || {});
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setErrors({});
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(form.entries());
    try {
      const url = mode === "login" ? session.routes.login : session.routes.register;
      const response = await apiJson<{ redirect: string }>(url || "", session.csrfToken, data);
      window.location.assign(response.redirect);
    } catch (error) {
      const payloadError = error as { errors?: FormErrors };
      setErrors(payloadError.errors || { __all__: ["操作失败，请稍后再试。"] });
    } finally {
      setPending(false);
    }
  }

  const isRegister = mode === "register";

  return (
    <main className="auth-shell">
      <section className="auth-art" aria-label="忆往昔">
        <EmptyBrand />
        <div className="auth-copy">
          <h1>{isRegister ? "从这里开始，把旧时光安静收好" : "回忆替TA陪我"}</h1>
          <p>那些没有被时间冲淡的瞬间，可以在这里以更体面的方式留下。</p>
          <div className="auth-notes" aria-label="支持内容">
            <span>照片</span>
            <span>视频</span>
            <span>文字</span>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-tabs" role="tablist" aria-label="登录注册">
          <button className={!isRegister ? "active" : ""} type="button" onClick={() => setMode("login")}>
            登录
          </button>
          {session.allowPublicRegistration ? (
            <button className={isRegister ? "active" : ""} type="button" onClick={() => setMode("register")}>
              注册
            </button>
          ) : null}
        </div>

        <h2>{isRegister ? "注册账号" : "登录"}</h2>
        <p className="panel-lede">{isRegister ? "创建后会自动进入你的私人回忆库。" : "回到只属于你的旧时光。"} </p>

        {errors.__all__?.length ? <div className="form-alert">{errors.__all__.join(" ")}</div> : null}

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>用户名</span>
            <span className="input-wrap">
              <UserRound size={16} />
              <input name="username" placeholder="用户名 / 邮箱" autoComplete="username" required />
            </span>
            {errors.username?.map((message) => <small key={message}>{message}</small>)}
          </label>

          {isRegister ? (
            <label>
              <span>邮箱</span>
              <span className="input-wrap">
                <Mail size={16} />
                <input name="email" type="email" placeholder="可选" autoComplete="email" />
              </span>
              {errors.email?.map((message) => <small key={message}>{message}</small>)}
            </label>
          ) : null}

          <label>
            <span>密码</span>
            <span className="input-wrap">
              <Lock size={16} />
              <input name={isRegister ? "password1" : "password"} type="password" placeholder="密码" autoComplete={isRegister ? "new-password" : "current-password"} required />
            </span>
            {(isRegister ? errors.password1 : errors.password)?.map((message) => <small key={message}>{message}</small>)}
          </label>

          {isRegister ? (
            <label>
              <span>确认密码</span>
              <span className="input-wrap">
                <Lock size={16} />
                <input name="password2" type="password" placeholder="再次输入密码" autoComplete="new-password" required />
              </span>
              {errors.password2?.map((message) => <small key={message}>{message}</small>)}
            </label>
          ) : (
            <input type="hidden" name="next" value={(payload.next as string) || ""} />
          )}

          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "请稍候..." : isRegister ? "注册并进入" : "登录"}
          </button>
        </form>

        {isRegister || session.allowPublicRegistration ? (
          <p className="auth-switch">
            {isRegister ? "已有账号？" : "还没有账号？"}
            <button type="button" onClick={() => setMode(isRegister ? "login" : "register")}>
              {isRegister ? "返回登录" : "立即注册"}
            </button>
          </p>
        ) : null}
      </section>
    </main>
  );
}
