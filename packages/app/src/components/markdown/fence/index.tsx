import { lazy, Suspense } from "react";
import { View } from "react-native";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
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
