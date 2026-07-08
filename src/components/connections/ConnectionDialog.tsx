import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DB_KINDS,
  type ConnConfig,
  type ConnInput,
  type DbKind,
  type SshAuthKind,
} from "@/types";
import { api, errMessage } from "@/lib/ipc";
import { useConnections } from "@/stores/connections";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

type FormState = {
  name: string;
  kind: DbKind;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  sshEnabled: boolean;
  sshHost: string;
  sshPort: string;
  sshUser: string;
  sshAuth: SshAuthKind;
  sshKeyPath: string;
  sshPassword: string;
  sshPassphrase: string;
};

const EMPTY: FormState = {
  name: "",
  kind: "mysql",
  host: "localhost",
  port: "3306",
  database: "",
  username: "",
  password: "",
  ssl: false,
  sshEnabled: false,
  sshHost: "",
  sshPort: "22",
  sshUser: "",
  sshAuth: "password",
  sshKeyPath: "",
  sshPassword: "",
  sshPassphrase: "",
};

function fromConfig(c: ConnConfig): FormState {
  return {
    ...EMPTY,
    name: c.name,
    kind: c.kind,
    host: c.host ?? "",
    port: c.port != null ? String(c.port) : "",
    database: c.database ?? "",
    username: c.username ?? "",
    password: "",
    ssl: c.ssl,
    sshEnabled: c.sshEnabled,
    sshHost: c.sshHost ?? "",
    sshPort: c.sshPort != null ? String(c.sshPort) : "22",
    sshUser: c.sshUser ?? "",
    sshAuth: c.sshAuth ?? "password",
    sshKeyPath: c.sshKeyPath ?? "",
  };
}

function toInput(id: string | undefined, f: FormState): ConnInput {
  const isSqlite = f.kind === "sqlite";
  const ssh = !isSqlite && f.sshEnabled;
  return {
    id: id ?? null,
    name: f.name.trim(),
    kind: f.kind,
    host: isSqlite ? null : f.host.trim() || null,
    port: isSqlite || !f.port ? null : Number(f.port),
    database: f.database.trim() || null,
    username: isSqlite ? null : f.username.trim() || null,
    password: isSqlite ? null : f.password || null,
    ssl: f.ssl,
    sshEnabled: ssh,
    sshHost: ssh ? f.sshHost.trim() || null : null,
    sshPort: ssh && f.sshPort ? Number(f.sshPort) : null,
    sshUser: ssh ? f.sshUser.trim() || null : null,
    sshAuth: f.sshAuth,
    sshKeyPath: ssh && f.sshAuth === "key" ? f.sshKeyPath.trim() || null : null,
    sshPassword: ssh && f.sshAuth === "password" ? f.sshPassword || null : null,
    sshPassphrase: ssh && f.sshAuth === "key" ? f.sshPassphrase || null : null,
  };
}

export function ConnectionDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: ConnConfig | null;
}) {
  const save = useConnections((s) => s.save);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(editing ? fromConfig(editing) : EMPTY);
  }, [open, editing]);

  const isSqlite = form.kind === "sqlite";
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function onKindChange(kind: DbKind) {
    const def = DB_KINDS.find((k) => k.value === kind);
    setForm((f) => ({
      ...f,
      kind,
      port: def?.defaultPort ? String(def.defaultPort) : "",
    }));
  }

  async function handleTest() {
    setTesting(true);
    try {
      await api.testConnection(toInput(editing?.id, form));
      toast.success("Conexão bem-sucedida");
    } catch (e) {
      toast.error("Falha no teste", { description: errMessage(e) });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Informe um nome para a conexão");
      return;
    }
    setSaving(true);
    const saved = await save(toInput(editing?.id, form));
    setSaving(false);
    if (saved) {
      toast.success(editing ? "Conexão atualizada" : "Conexão criada");
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar conexão" : "Nova conexão"}</DialogTitle>
          <DialogDescription>
            Configure o acesso ao banco. A senha é guardada no keychain do sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-3 overflow-y-auto py-2 pr-1">
          <Field label="Nome">
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Meu banco"
              autoFocus
            />
          </Field>

          <Field label="Tipo">
            <Select value={form.kind} onValueChange={(v) => onKindChange(v as DbKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DB_KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {isSqlite ? (
            <Field label="Arquivo (.db)">
              <Input
                value={form.database}
                onChange={(e) => set("database", e.target.value)}
                placeholder="/caminho/para/banco.db"
              />
            </Field>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <Field label="Host">
                  <Input
                    value={form.host}
                    onChange={(e) => set("host", e.target.value)}
                    placeholder="localhost"
                  />
                </Field>
                <Field label="Porta">
                  <Input
                    value={form.port}
                    inputMode="numeric"
                    onChange={(e) => set("port", e.target.value.replace(/\D/g, ""))}
                  />
                </Field>
              </div>
              <Field label="Banco de dados">
                <Input
                  value={form.database}
                  onChange={(e) => set("database", e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Usuário">
                  <Input
                    value={form.username}
                    onChange={(e) => set("username", e.target.value)}
                  />
                </Field>
                <Field label="Senha">
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    placeholder={editing ? "•••••• (inalterada)" : ""}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.ssl}
                  onChange={(e) => set("ssl", e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Usar SSL/TLS
              </label>

              {/* Túnel SSH */}
              <div className="mt-1 border-t pt-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={form.sshEnabled}
                    onChange={(e) => set("sshEnabled", e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  Conectar via túnel SSH
                </label>

                {form.sshEnabled && (
                  <div className="mt-3 grid gap-3">
                    <div className="grid grid-cols-[1fr_90px] gap-2">
                      <Field label="Host SSH">
                        <Input
                          value={form.sshHost}
                          onChange={(e) => set("sshHost", e.target.value)}
                          placeholder="bastion.exemplo.com"
                        />
                      </Field>
                      <Field label="Porta">
                        <Input
                          value={form.sshPort}
                          inputMode="numeric"
                          onChange={(e) =>
                            set("sshPort", e.target.value.replace(/\D/g, ""))
                          }
                        />
                      </Field>
                    </div>
                    <Field label="Usuário SSH">
                      <Input
                        value={form.sshUser}
                        onChange={(e) => set("sshUser", e.target.value)}
                      />
                    </Field>
                    <Field label="Autenticação">
                      <Select
                        value={form.sshAuth}
                        onValueChange={(v) => set("sshAuth", v as SshAuthKind)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="password">Senha</SelectItem>
                          <SelectItem value="key">Chave privada</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    {form.sshAuth === "password" ? (
                      <Field label="Senha SSH">
                        <Input
                          type="password"
                          value={form.sshPassword}
                          onChange={(e) => set("sshPassword", e.target.value)}
                          placeholder={editing ? "•••••• (inalterada)" : ""}
                        />
                      </Field>
                    ) : (
                      <>
                        <Field label="Arquivo da chave privada">
                          <Input
                            value={form.sshKeyPath}
                            onChange={(e) => set("sshKeyPath", e.target.value)}
                            placeholder="~/.ssh/id_ed25519"
                          />
                        </Field>
                        <Field label="Passphrase (opcional)">
                          <Input
                            type="password"
                            value={form.sshPassphrase}
                            onChange={(e) => set("sshPassphrase", e.target.value)}
                            placeholder={editing ? "•••••• (inalterada)" : ""}
                          />
                        </Field>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
            {testing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Testar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
