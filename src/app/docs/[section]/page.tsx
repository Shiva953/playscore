import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocSection, DocsNav } from "@/components/docs/docs-content";
import { DOC_SECTIONS, type DocSlug } from "@/components/docs/sections";

export function generateStaticParams() {
  return DOC_SECTIONS.map((s) => ({ section: s.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const { section } = await params;
  const s = DOC_SECTIONS.find((x) => x.slug === section);
  return { title: s ? `Docs · ${s.title}` : "Docs" };
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const s = DOC_SECTIONS.find((x) => x.slug === section);
  if (!s) notFound();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[180px_minmax(0,1fr)]">
      {/* min-w-0: the section tabs scroll sideways on a phone instead of widening the page. */}
      <aside className="min-w-0">
        <DocsNav active={s.slug as DocSlug} />
      </aside>
      <article className="flex min-w-0 flex-col gap-4 [&_li]:max-w-[68ch] [&_p]:max-w-[68ch]">
        <h1 className="text-[2rem] leading-[1.12] font-semibold text-ink">{s.title}</h1>
        <DocSection slug={s.slug as DocSlug} />
      </article>
    </div>
  );
}
