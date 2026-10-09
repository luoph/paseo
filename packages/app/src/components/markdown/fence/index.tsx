import { lazy, Suspense } from "react";
import { Text, View } from "react-native";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { legacyMermaidSourcePreview } from "./legacy-mermaid";
import { getMarkdownFenceLanguage } from "./language";
import type { MarkdownFenceRendererProps } from "./types";

const MermaidFence = lazy(() =>
  import("./mermaid").then((module) => ({ default: module.MermaidFence })),
);

const mermaidLoadingStyle = { height: 240 };
const mermaidFallback = <View style={mermaidLoadingStyle} />;

export interface MarkdownFenceBlockProps extends MarkdownFenceRendererProps {
  info: string | null | undefined;
}

export function MarkdownFenceBlock({
  code,
  info,
  phase,
  inheritedStyles,
  textStyle,
}: MarkdownFenceBlockProps) {
  const language = getMarkdownFenceLanguage(info);
  const legacyPreview = legacyMermaidSourcePreview(language, code);
  if (legacyPreview !== null) {
    return <Text style={textStyle}>{legacyPreview}</Text>;
  }
  if (language === "mermaid") {
    return (
      <Suspense fallback={mermaidFallback}>
        <MermaidFence
          code={code}
          phase={phase}
          inheritedStyles={inheritedStyles}
          textStyle={textStyle}
        />
      </Suspense>
    );
  }
  return (
    <HighlightedCodeBlock
      code={code}
      language={language}
      inheritedStyles={inheritedStyles}
      textStyle={textStyle}
    />
  );
}
