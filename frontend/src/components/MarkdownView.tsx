import type { ReactNode } from "react";

type MarkdownViewProps = {
  value?: string;
  emptyText?: string;
};

function isSafeHref(href: string) {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(href.trim());
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let plain = "";
  let tokenIndex = 0;
  let index = 0;

  function flushPlain() {
    if (!plain) return;
    nodes.push(plain);
    plain = "";
  }

  while (index < text.length) {
    if (text[index] === "\n") {
      flushPlain();
      nodes.push(<br key={`${keyPrefix}-br-${tokenIndex++}`} />);
      index += 1;
      continue;
    }

    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end > index + 1) {
        flushPlain();
        nodes.push(<code key={`${keyPrefix}-code-${tokenIndex++}`}>{text.slice(index + 1, end)}</code>);
        index = end + 1;
        continue;
      }
    }

    if (text[index] === "[") {
      const labelEnd = text.indexOf("]", index + 1);
      const hrefStart = labelEnd >= 0 ? text.indexOf("(", labelEnd) : -1;
      const hrefEnd = hrefStart >= 0 ? text.indexOf(")", hrefStart) : -1;
      if (labelEnd > index + 1 && hrefStart === labelEnd + 1 && hrefEnd > hrefStart + 1) {
        const href = text.slice(hrefStart + 1, hrefEnd).trim();
        if (isSafeHref(href)) {
          const linkKey = `${keyPrefix}-link-${tokenIndex++}`;
          const external = /^https?:\/\//i.test(href);
          flushPlain();
          nodes.push(
            <a key={linkKey} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
              {renderInline(text.slice(index + 1, labelEnd), linkKey)}
            </a>,
          );
          index = hrefEnd + 1;
          continue;
        }
      }
    }

    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2);
      if (end > index + 2) {
        const strongKey = `${keyPrefix}-strong-${tokenIndex++}`;
        flushPlain();
        nodes.push(<strong key={strongKey}>{renderInline(text.slice(index + 2, end), strongKey)}</strong>);
        index = end + 2;
        continue;
      }
    }

    if (text[index] === "*") {
      const end = text.indexOf("*", index + 1);
      if (end > index + 1) {
        const emphasisKey = `${keyPrefix}-em-${tokenIndex++}`;
        flushPlain();
        nodes.push(<em key={emphasisKey}>{renderInline(text.slice(index + 1, end), emphasisKey)}</em>);
        index = end + 1;
        continue;
      }
    }

    plain += text[index];
    index += 1;
  }

  flushPlain();
  return nodes;
}

function isBlockStart(line: string) {
  return /^(#{1,4}\s+|```\s*|>\s?|[-*+]\s+|\d+\.\s+)/.test(line.trimStart());
}

export function MarkdownView({ value, emptyText = "这段回忆还没有正文。" }: MarkdownViewProps) {
  const source = (value || "").replace(/\r\n/g, "\n").trim();

  if (!source) {
    return <p className="markdown-empty">{emptyText}</p>;
  }

  const blocks: ReactNode[] = [];
  const lines = source.split("\n");
  let blockIndex = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = trimmed.match(/^```\s*(.*)$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre key={`block-${blockIndex++}`}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
      blocks.push(<HeadingTag key={`block-${blockIndex}`}>{renderInline(heading[2], `block-${blockIndex++}`)}</HeadingTag>);
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trimStart().startsWith(">")) {
        quoteLines.push(lines[index].trimStart().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`block-${blockIndex++}`}>
          <MarkdownView value={quoteLines.join("\n")} />
        </blockquote>,
      );
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const orderedList = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const match = orderedList ? current.match(/^\d+\.\s+(.+)$/) : current.match(/^[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      const ListTag = orderedList ? "ol" : "ul";
      blocks.push(
        <ListTag key={`block-${blockIndex}`}>
          {items.map((item, itemIndex) => (
            <li key={`block-${blockIndex}-item-${itemIndex}`}>{renderInline(item, `block-${blockIndex}-item-${itemIndex}`)}</li>
          ))}
        </ListTag>,
      );
      blockIndex += 1;
      continue;
    }

    const paragraph: string[] = [line.trimEnd()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trimEnd());
      index += 1;
    }
    blocks.push(<p key={`block-${blockIndex}`}>{renderInline(paragraph.join("\n"), `block-${blockIndex++}`)}</p>);
  }

  return <div className="markdown-body">{blocks}</div>;
}
