
import React from 'react';

interface MarkdownRendererProps {
    content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
    if (!content) return null;

    return (
        <div className="space-y-4">
            {content.split('\n').map((line, index) => {
                const trimmed = line.trim();
                if (!trimmed) return <div key={index} className="h-4" />;

                // Header 1
                if (trimmed.startsWith('# ')) {
                    return (
                        <h1 key={index} className="text-2xl font-bold mt-8 mb-4">
                            {trimmed.replace('# ', '')}
                        </h1>
                    );
                }

                // Header 2
                if (trimmed.startsWith('## ')) {
                    return (
                        <h2 key={index} className="text-xl font-semibold mt-6 mb-3">
                            {trimmed.replace('## ', '')}
                        </h2>
                    );
                }

                // Bullet points
                if (trimmed.startsWith('• ') || trimmed.startsWith('- ')) {
                    return (
                        <div key={index} className="flex gap-2 ml-4">
                            <span>•</span>
                            <span>{trimmed.substring(2)}</span>
                        </div>
                    )
                }

                // Paragraph
                return (
                    <p key={index} className="leading-relaxed text-muted-foreground">
                        {line}
                    </p>
                );
            })}
        </div>
    );
}
