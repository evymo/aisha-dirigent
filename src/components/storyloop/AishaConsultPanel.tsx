import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  Send, 
  Loader2,
  X,
  Info,
  ChevronDown,
  Bot,
} from 'lucide-react';
import { AishaAvatar } from '@/components/chat/AishaAvatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useStoryAiConsult } from '@/hooks/useStoryAiConsult';
import { AishaQuickActions } from './AishaQuickActions';
import { toast } from 'sonner';
import type { AiConsultResponse } from '@/schemas/storyLoopSchemas';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

interface AishaConsultPanelProps {
  storyId: string;
  storyTitle: string;
  userName?: string | null;
  trigger?: React.ReactNode;
  onClose?: () => void;
  embedded?: boolean;
}

export function AishaConsultPanel({ 
  storyId, 
  storyTitle,
  userName,
  trigger,
  onClose,
  embedded = false,
}: AishaConsultPanelProps) {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isContextOpen, setIsContextOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const ai = useStoryAiConsult({ storyId, language: i18n.language });
  const messages: Message[] = ai.messages;

  // Scroll to bottom when new messages arrive or loading state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, ai.isLoading]);

  const handleSend = async () => {
    if (!input.trim() || ai.isChatLoading) return;

    const userMessage = input.trim();
    setInput('');

    try {
      await ai.sendChat(userMessage);
    } catch {
      toast.error(t('errors.genericError'), {
        description: t('storyloop.aisha.errorGenerating'),
      });
    }
  };

  const handleQuickAction = async (
    action: 'recap' | 'translate' | 'recommend' | 'analyze',
    fn: () => Promise<AiConsultResponse>
  ) => {
    const actionLabels: Record<string, string> = {
      recap: t('storyloop.aisha.recap'),
      translate: t('storyloop.aisha.translate'),
      recommend: t('storyloop.aisha.recommend'),
      analyze: t('storyloop.aisha.analyze'),
    };

    try {
      await fn();
    } catch {
      toast.error(t('errors.genericError'), {
        description: `${t('storyloop.aisha.errorGenerating')} (${actionLabels[action]})`,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClose = () => {
    if (!embedded) {
      setIsOpen(false);
    }
    onClose?.();
  };

  const defaultTrigger = (
    <Button variant="outline" className="gap-2">
      <Bot className="h-4 w-4" />
      {t('storyloop.aisha.consult')}
    </Button>
  );

  const panelBody = (
    <>
      {/* Header */}
      <SheetHeader className="px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AishaAvatar size="md" />
            <div>
              <SheetTitle className="text-base">{t('storyloop.aisha.title')}</SheetTitle>
              <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                {userName ? `${storyTitle} • ${userName}` : storyTitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClose}>
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('common.close')}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </SheetHeader>

      {/* Context Info */}
      <Collapsible open={isContextOpen} onOpenChange={setIsContextOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full px-4 py-2 flex items-center justify-between text-xs text-muted-foreground hover:bg-muted/50 transition-colors border-b border-border">
            <span className="flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" />
              {t('storyloop.aisha.contextInfo')}
            </span>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isContextOpen ? 'rotate-180' : ''}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 py-2 bg-muted/30 text-xs text-muted-foreground border-b border-border">
            <p>{t('storyloop.aisha.contextDescription')}</p>
            <div className="flex flex-wrap gap-1 mt-2">
              <Badge variant="secondary" className="text-xs">Timeline</Badge>
              <Badge variant="secondary" className="text-xs">Check-ins</Badge>
              <Badge variant="secondary" className="text-xs">Documents</Badge>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Quick Actions */}
      <div className="px-4 py-3 border-b border-border bg-muted/20">
        <AishaQuickActions
          onRecap={() => handleQuickAction('recap', ai.generateRecap)}
          onTranslate={() => handleQuickAction('translate', () => ai.translate({ targetLanguage: 'en' }))}
          onRecommend={() => handleQuickAction('recommend', ai.generateRecommendations)}
          onAnalyze={() => handleQuickAction('analyze', ai.analyzeTracking)}
          isRecapLoading={ai.isRecapLoading}
          isTranslateLoading={ai.isTranslateLoading}
          isRecommendLoading={ai.isRecommendLoading}
          isAnalyzeLoading={ai.isAnalyzeLoading}
          disabled={ai.isLoading}
        />
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4" ref={scrollRef}>
        <div className="py-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <AishaAvatar size="lg" className="mx-auto mb-2 opacity-60" />
              <p>{t('storyloop.aisha.startConversation')}</p>
            </div>
          )}
          
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <AishaAvatar size="sm" className="mt-1" />
              )}
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}

          {ai.isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">
                  {ai.isChatLoading && t('storyloop.aisha.thinkingChat')}
                  {ai.isRecapLoading && t('storyloop.aisha.thinkingRecap')}
                  {ai.isTranslateLoading && t('storyloop.aisha.thinkingTranslate')}
                  {ai.isRecommendLoading && t('storyloop.aisha.thinkingRecommend')}
                  {ai.isAnalyzeLoading && t('storyloop.aisha.thinkingAnalyze')}
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t border-border bg-background">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('storyloop.aisha.placeholder')}
            className="min-h-[60px] max-h-[120px] resize-none"
            disabled={ai.isLoading}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || ai.isLoading}
            size="icon"
            className="shrink-0 self-end"
          >
            {ai.isChatLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="h-full flex flex-col min-h-0">
        {panelBody}
      </div>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        {trigger || defaultTrigger}
      </SheetTrigger>
      
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0">
        {panelBody}
      </SheetContent>
    </Sheet>
  );
}
