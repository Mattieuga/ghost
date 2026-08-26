import { useMemo, useState } from "react";
import { getBrowserCloudClient } from "@/cloud/browser-cloud-client";
import { CloudSignIn } from "@/cloud/cloud-sign-in";
import { CloudTree } from "@/cloud/cloud-tree";
import { CloudDocumentEditor } from "@/cloud/cloud-document-editor";
import { useCloudAccount } from "@/cloud/use-cloud-account";
import { useCloudTree } from "@/cloud/use-cloud-tree";
import type { CloudItem } from "@/cloud/cloud-data";

export function CloudWebApp() {
  const client = useMemo(() => getBrowserCloudClient(), []);
  const emailRedirectTo = useMemo(() => new URL("web.html", window.location.href).href, []);
  const account = useCloudAccount(client);
  const user = account.kind === "signed-in" ? account.user : null;
  const tree = useCloudTree(client, user?.id ?? null);
  const [activeDocument, setActiveDocument] = useState<CloudItem | null>(null);

  if (!client || account.kind === "error") {
    return (
      <FullPageNotice title="Cloud unavailable">
        {account.kind === "error" ? account.message : "Ghost Cloud is not configured."}
      </FullPageNotice>
    );
  }
  if (account.kind === "loading") return <FullPageNotice>Loading your account…</FullPageNotice>;
  if (account.kind === "signed-out") {
    return (
      <main className="flex min-h-svh items-center justify-center overflow-auto bg-background px-6 py-12 text-foreground">
        <div>
          <div className="mb-8 text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ghost-amber">Ghost Cloud</div>
            <h1 className="mt-2 font-serif text-3xl">Markdown, together.</h1>
          </div>
          <CloudSignIn client={client} emailRedirectTo={emailRedirectTo} />
        </div>
      </main>
    );
  }

  return (
    <main className="grid h-svh min-h-0 grid-cols-[260px_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
      <CloudTree
        client={client}
        tree={tree}
        selectedId={activeDocument?.id ?? null}
        onSelectDocument={setActiveDocument}
      />
      <section className="min-h-0 min-w-0">
        {activeDocument ? (
          <CloudDocumentEditor
            key={activeDocument.id}
            client={client}
            user={account.user}
            documentId={activeDocument.id}
            title={activeDocument.name}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-8 text-center">
            <div>
              <p className="text-base font-medium">Your Cloud workspace</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Create or select a Markdown document to start editing.
              </p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function FullPageNotice({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-8 text-foreground">
      <div className="max-w-lg rounded-xl border border-border bg-card px-6 py-5 text-center">
        {title ? <h1 className="mb-2 text-lg font-semibold">{title}</h1> : null}
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </main>
  );
}
