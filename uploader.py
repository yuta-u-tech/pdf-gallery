#!/usr/bin/env python3
"""
PDF Gallery Uploader
PDF リポジトリの管理 GUI ツール

依存:
  pip install git-filter-repo   # 「履歴を削除して置換」機能を使う場合のみ
"""

import hashlib
import json
import subprocess
import shutil
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext, simpledialog, ttk
from typing import Optional

CONFIG_FILE = Path.home() / ".pdf_gallery_uploader.json"


# ── 設定 ──────────────────────────────────────────────────────────────────────

class Config:
    def __init__(self):
        self.repo_path: str = ""
        self.subfolder: str = ""
        self.admin_pw_hash: str = ""
        self._load()

    def _load(self):
        if CONFIG_FILE.exists():
            try:
                d = json.loads(CONFIG_FILE.read_text())
                self.repo_path     = d.get("repo_path", "")
                self.subfolder     = d.get("subfolder", "")
                self.admin_pw_hash = d.get("admin_pw_hash", "")
            except Exception:
                pass

    def save(self):
        CONFIG_FILE.write_text(json.dumps({
            "repo_path":     self.repo_path,
            "subfolder":     self.subfolder,
            "admin_pw_hash": self.admin_pw_hash,
        }, ensure_ascii=False, indent=2))

    def verify(self, pw: str) -> bool:
        if not self.admin_pw_hash:
            return True
        return hashlib.sha256(pw.encode()).hexdigest() == self.admin_pw_hash

    def set_password(self, pw: str):
        self.admin_pw_hash = hashlib.sha256(pw.encode()).hexdigest()
        self.save()


# ── Git ヘルパー ──────────────────────────────────────────────────────────────

def _git(args: list, cwd: str, log=None):
    res = subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True)
    out = (res.stdout + res.stderr).strip()
    if log and out:
        log(f"$ git {' '.join(args)}\n{out}")
    return res.returncode, out


def _remote_url(repo: str) -> str:
    res = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=repo, capture_output=True, text=True,
    )
    return res.stdout.strip()


def _filter_repo_available() -> bool:
    try:
        subprocess.run(["git", "filter-repo", "--version"],
                       capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def upload_new(repo: str, rel: str, src: Path, log) -> bool:
    """新規ファイルとして追加"""
    shutil.copy2(src, Path(repo) / rel)
    _git(["add", rel], repo, log)
    c, _ = _git(["commit", "-m", f"add: {src.name}"], repo, log)
    if c != 0:
        return False
    c, _ = _git(["push"], repo, log)
    return c == 0


def upload_overwrite(repo: str, rel: str, src: Path, log) -> bool:
    """そのまま上書き（履歴は保持）"""
    shutil.copy2(src, Path(repo) / rel)
    _git(["add", rel], repo, log)
    c, _ = _git(["commit", "-m", f"update: {src.name}"], repo, log)
    if c != 0:
        return False
    c, _ = _git(["push"], repo, log)
    return c == 0


def upload_clean(repo: str, rel: str, src: Path, log) -> bool:
    """
    旧バージョンの履歴を完全削除してから新しいファイルを追加。
    git filter-repo が必要。force push を実行する。
    """
    # 1. remote URL を退避 (filter-repo が remote を削除するため)
    url = _remote_url(repo)
    log(f"remote URL を記録: {url}")

    # 2. 対象ファイルを git 履歴から消去
    c, out = _git(
        ["filter-repo", "--invert-paths", "--path", rel, "--force"],
        repo, log,
    )
    if c != 0:
        log(f"❌ filter-repo 失敗: {out}")
        return False

    # 3. filter-repo が remote を削除した場合は復元
    if _remote_url(repo) == "" and url:
        _git(["remote", "add", "origin", url], repo, log)
        log(f"remote を復元: {url}")

    # 4. 新ファイルを追加してコミット
    shutil.copy2(src, Path(repo) / rel)
    _git(["add", rel], repo, log)
    c, _ = _git(["commit", "-m", f"replace: {src.name} (history cleaned)"], repo, log)
    if c != 0:
        return False

    # 5. force push（履歴書き換えのため必須）
    c, _ = _git(["push", "--force"], repo, log)
    return c == 0


def delete_pdf(repo: str, rel: str, log) -> bool:
    c, _ = _git(["rm", rel], repo, log)
    if c != 0:
        return False
    c, _ = _git(["commit", "-m", f"remove: {Path(rel).name}"], repo, log)
    if c != 0:
        return False
    c, _ = _git(["push"], repo, log)
    return c == 0


# ── GUI アプリ ────────────────────────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("PDF Gallery Manager")
        self.geometry("820x680")
        self.minsize(640, 520)
        self._cfg  = Config()
        self._auth = False
        self._sel: Optional[Path] = None
        self._build()
        if self._cfg.repo_path:
            self._refresh()

    # ── UI 構築 ───────────────────────────────────────────────────────────────

    def _build(self):
        s = ttk.Style()
        try:
            s.theme_use("clam")
        except Exception:
            pass
        s.configure("H1.TLabel", font=("Yu Mincho", 15, "bold"))

        P = dict(padx=12, pady=6)

        # タイトル行
        top = ttk.Frame(self)
        top.pack(fill=tk.X, **P)
        ttk.Label(top, text="PDF Gallery Manager", style="H1.TLabel").pack(side=tk.LEFT)
        self._login_btn = ttk.Button(top, text="🔑  管理者ログイン", command=self._toggle_login)
        self._login_btn.pack(side=tk.RIGHT)
        self._auth_lbl = ttk.Label(top, text="未ログイン", foreground="#999")
        self._auth_lbl.pack(side=tk.RIGHT, padx=10)

        ttk.Separator(self).pack(fill=tk.X)

        # リポジトリ設定
        rf = ttk.LabelFrame(self, text=" リポジトリ設定 ", padding=8)
        rf.pack(fill=tk.X, **P)
        rf.columnconfigure(1, weight=1)

        ttk.Label(rf, text="ローカルリポジトリ:").grid(row=0, column=0, sticky=tk.W)
        self._repo_var = tk.StringVar(value=self._cfg.repo_path)
        ttk.Entry(rf, textvariable=self._repo_var).grid(row=0, column=1, sticky=tk.EW, padx=4)
        ttk.Button(rf, text="参照…", command=self._browse).grid(row=0, column=2)
        ttk.Button(rf, text="適用",  command=self._apply).grid(row=0, column=3, padx=(4, 0))

        ttk.Label(rf, text="PDF フォルダ:").grid(row=1, column=0, sticky=tk.W, pady=(4, 0))
        self._sub_var = tk.StringVar(value=self._cfg.subfolder)
        ttk.Entry(rf, textvariable=self._sub_var, width=28).grid(
            row=1, column=1, sticky=tk.W, padx=4, pady=(4, 0))
        ttk.Label(rf, text="空欄 = ルート直下", foreground="#999").grid(
            row=1, column=2, columnspan=2, sticky=tk.W, pady=(4, 0))

        # PDF 一覧
        lf = ttk.LabelFrame(self, text=" リポジトリ内の PDF ", padding=6)
        lf.pack(fill=tk.BOTH, expand=True, **P)

        self._tree = ttk.Treeview(lf, columns=("name", "size"),
                                   show="headings", height=8, selectmode="browse")
        self._tree.heading("name", text="ファイル名")
        self._tree.heading("size", text="サイズ", anchor=tk.E)
        self._tree.column("name", stretch=True)
        self._tree.column("size", width=100, anchor=tk.E)
        ys = ttk.Scrollbar(lf, orient=tk.VERTICAL, command=self._tree.yview)
        self._tree.configure(yscrollcommand=ys.set)
        self._tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        ys.pack(side=tk.RIGHT, fill=tk.Y)

        list_btns = ttk.Frame(self)
        list_btns.pack(fill=tk.X, padx=12, pady=(0, 4))
        ttk.Button(list_btns, text="🔄 一覧を更新", command=self._refresh).pack(side=tk.LEFT)
        self._del_btn = ttk.Button(list_btns, text="🗑 選択を削除",
                                    command=self._delete, state=tk.DISABLED)
        self._del_btn.pack(side=tk.RIGHT)

        # アップロード
        uf = ttk.LabelFrame(self, text=" アップロード ", padding=10)
        uf.pack(fill=tk.X, **P)

        row1 = ttk.Frame(uf)
        row1.pack(fill=tk.X)
        self._sel_btn = ttk.Button(row1, text="📂  PDF を選択…",
                                    command=self._select_pdf, state=tk.DISABLED)
        self._sel_btn.pack(side=tk.LEFT)
        self._sel_lbl = ttk.Label(row1, text="未選択", foreground="#999")
        self._sel_lbl.pack(side=tk.LEFT, padx=10)

        # 競合時のみ表示
        self._cf = ttk.Frame(uf)
        self._cf_lbl = ttk.Label(self._cf, foreground="#C94040", font=("", 9, "bold"))
        self._cf_lbl.pack(anchor=tk.W)
        self._mode = tk.StringVar(value="clean")
        ttk.Radiobutton(self._cf,
                         text="🧹  履歴を削除して置換  （git filter-repo + force push）",
                         variable=self._mode, value="clean").pack(anchor=tk.W, padx=20, pady=1)
        ttk.Radiobutton(self._cf,
                         text="📝  そのまま上書き  （履歴は残るが手軽）",
                         variable=self._mode, value="overwrite").pack(anchor=tk.W, padx=20, pady=1)

        self._up_btn = ttk.Button(uf, text="⬆  アップロード実行",
                                   command=self._upload, state=tk.DISABLED)
        self._up_btn.pack(pady=(8, 0))

        # ログ
        logf = ttk.LabelFrame(self, text=" ログ ", padding=4)
        logf.pack(fill=tk.X, **P)
        self._log_box = scrolledtext.ScrolledText(
            logf, height=6, state=tk.DISABLED,
            font=("Courier New", 10), wrap=tk.WORD)
        self._log_box.pack(fill=tk.X)

    # ── ロギング ──────────────────────────────────────────────────────────────

    def _log(self, msg: str):
        self._log_box.config(state=tk.NORMAL)
        ts = datetime.now().strftime("%H:%M:%S")
        self._log_box.insert(tk.END, f"[{ts}]  {msg}\n")
        self._log_box.see(tk.END)
        self._log_box.config(state=tk.DISABLED)
        self.update_idletasks()

    # ── 状態管理 ──────────────────────────────────────────────────────────────

    def _pdf_dir(self) -> Optional[Path]:
        repo = self._repo_var.get().strip()
        if not repo:
            return None
        sub = self._sub_var.get().strip()
        p = (Path(repo) / sub) if sub else Path(repo)
        return p if p.is_dir() else None

    def _rel(self, fname: str) -> str:
        sub = self._sub_var.get().strip()
        return f"{sub}/{fname}" if sub else fname

    def _existing(self) -> set:
        return {self._tree.item(i, "values")[0] for i in self._tree.get_children()}

    def _refresh(self):
        self._tree.delete(*self._tree.get_children())
        d = self._pdf_dir()
        if d is None:
            return
        for f in sorted(d.glob("*.pdf")):
            sz = f.stat().st_size
            label = f"{sz/1024:.1f} KB" if sz < 1_000_000 else f"{sz/1_048_576:.1f} MB"
            self._tree.insert("", tk.END, iid=f.name, values=(f.name, label))
        self._sync_buttons()

    def _sync_buttons(self):
        auth, has_sel = self._auth, self._sel is not None
        self._sel_btn.config(state=tk.NORMAL  if auth             else tk.DISABLED)
        self._del_btn.config(state=tk.NORMAL  if auth             else tk.DISABLED)
        self._up_btn .config(state=tk.NORMAL  if auth and has_sel else tk.DISABLED)

    # ── ログイン ──────────────────────────────────────────────────────────────

    def _toggle_login(self):
        if self._auth:
            if messagebox.askyesno("ログアウト", "ログアウトしますか？"):
                self._auth = False
                self._auth_lbl.config(text="未ログイン", foreground="#999")
                self._login_btn.config(text="🔑  管理者ログイン")
                self._sync_buttons()
            return

        if not self._cfg.admin_pw_hash:
            pw = simpledialog.askstring(
                "初回設定", "管理者パスワードを設定してください:", show="*")
            if not pw:
                return
            self._cfg.set_password(pw)
            self._log("管理者パスワードを設定しました。")
        else:
            pw = simpledialog.askstring("管理者ログイン", "パスワード:", show="*")
            if pw is None:
                return
            if not self._cfg.verify(pw):
                messagebox.showerror("エラー", "パスワードが違います")
                return

        self._auth = True
        self._auth_lbl.config(text="● 管理者", foreground="green")
        self._login_btn.config(text="ログアウト")
        self._sync_buttons()
        self._log("管理者としてログインしました。")

    # ── リポジトリ設定 ────────────────────────────────────────────────────────

    def _browse(self):
        d = filedialog.askdirectory(title="ローカルリポジトリを選択")
        if d:
            self._repo_var.set(d)
            self._apply()

    def _apply(self):
        self._cfg.repo_path = self._repo_var.get().strip()
        self._cfg.subfolder = self._sub_var.get().strip()
        self._cfg.save()
        self._refresh()
        sub = self._cfg.subfolder or "(ルート直下)"
        self._log(f"リポジトリ: {self._cfg.repo_path}  /  フォルダ: {sub}")

    # ── PDF 選択 ──────────────────────────────────────────────────────────────

    def _select_pdf(self):
        path = filedialog.askopenfilename(
            title="アップロードする PDF を選択",
            filetypes=[("PDF ファイル", "*.pdf")])
        if not path:
            return
        self._sel = Path(path)
        self._sel_lbl.config(text=self._sel.name, foreground="black")

        if self._sel.name in self._existing():
            self._cf_lbl.config(
                text=f'⚠  「{self._sel.name}」は既に存在します。置換方法を選択してください。')
            self._cf.pack(fill=tk.X, pady=(6, 0))
        else:
            self._cf.pack_forget()

        self._sync_buttons()

    # ── アップロード ──────────────────────────────────────────────────────────

    def _upload(self):
        if not self._sel:
            return
        repo = self._repo_var.get().strip()
        rel  = self._rel(self._sel.name)
        conflict = self._sel.name in self._existing()

        if conflict and self._mode.get() == "clean":
            if not _filter_repo_available():
                messagebox.showerror(
                    "git-filter-repo が必要です",
                    "以下のコマンドでインストールしてください:\n\n"
                    "  pip install git-filter-repo")
                return
            if not messagebox.askyesno(
                "確認 — 履歴を削除して置換",
                f'「{self._sel.name}」のすべての git 履歴を削除してから\n'
                "新しいファイルを追加します。\n\n"
                "⚠ この操作は取り消しできません。\n"
                "force push が実行されます。\n\n続行しますか？"):
                return
            self._log(f"履歴を削除して置換: {rel}")
            ok = upload_clean(repo, rel, self._sel, self._log)

        elif conflict:
            self._log(f"上書きアップロード: {rel}")
            ok = upload_overwrite(repo, rel, self._sel, self._log)

        else:
            self._log(f"新規アップロード: {rel}")
            ok = upload_new(repo, rel, self._sel, self._log)

        if ok:
            self._log(f"✅ 完了: {self._sel.name}")
            self._sel = None
            self._sel_lbl.config(text="未選択", foreground="#999")
            self._cf.pack_forget()
            self._refresh()
        else:
            messagebox.showerror("エラー", "アップロードに失敗しました。ログを確認してください。")

    # ── 削除 ──────────────────────────────────────────────────────────────────

    def _delete(self):
        sel = self._tree.selection()
        if not sel:
            messagebox.showinfo("", "ファイルを選択してください。")
            return
        fname = sel[0]
        if not messagebox.askyesno("確認", f'「{fname}」を削除してプッシュしますか？'):
            return
        repo = self._repo_var.get().strip()
        rel  = self._rel(fname)
        self._log(f"削除: {rel}")
        if delete_pdf(repo, rel, self._log):
            self._log(f"✅ 削除完了: {fname}")
            self._refresh()
        else:
            messagebox.showerror("エラー", "削除に失敗しました。ログを確認してください。")


# ── エントリポイント ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    app = App()
    app.mainloop()
