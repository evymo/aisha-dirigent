/**
 * Partner Template Builder
 * 
 * UI for partners to create templates from predefined blocks.
 * Partners can only use blocks from our library - no custom blocks allowed.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Calendar,
  ClipboardList,
  FileSignature,
  MessageSquare,
  CheckCircle,
  GripVertical,
  Plus,
  Trash2,
  Settings2,
  X,
  Activity,
  Heart,
  Pill,
  BookOpen,
  Upload,
  FlaskConical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  BLOCK_LIBRARY,
  getBlocksByCategory,
  type TemplateBlockConfig,
  type PartnerTemplate,
  type BlockLibraryEntry,
} from '@/schemas/partnerTemplateSchemas';

interface PartnerTemplateBuilderProps {
  template?: PartnerTemplate;
  onSave: (template: Omit<PartnerTemplate, 'id' | 'partner_id' | 'usage_count' | 'last_used_at' | 'created_at' | 'updated_at'>) => void;
  onCancel: () => void;
}

const iconMap: Record<string, typeof Calendar> = {
  Calendar,
  ClipboardList,
  FileSignature,
  MessageSquare,
  CheckCircle,
  Activity,
  Heart,
  Pill,
  BookOpen,
  Upload,
  FlaskConical,
};

const categoryColors: Record<string, string> = {
  meeting: 'bg-info/10 text-info border-info/20',
  questionnaire: 'bg-primary/10 text-primary border-primary/20',
  consent: 'bg-warning/10 text-warning border-warning/20',
  info: 'bg-muted text-muted-foreground border-muted',
  action: 'bg-success/10 text-success border-success/20',
};

interface SortableBlockProps {
  block: TemplateBlockConfig;
  libraryEntry: BlockLibraryEntry | undefined;
  onRemove: () => void;
  onConfigure: () => void;
}

function SortableBlock({ block, libraryEntry, onRemove, onConfigure }: SortableBlockProps) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const Icon = libraryEntry ? iconMap[libraryEntry.icon] || ClipboardList : ClipboardList;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg border bg-card',
        isDragging && 'opacity-50 shadow-lg',
        libraryEntry && categoryColors[libraryEntry.category]
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab hover:text-foreground text-muted-foreground"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="p-1.5 rounded-md bg-background">
        <Icon className="h-4 w-4" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">
          {block.custom_title || (libraryEntry ? t(libraryEntry.name_key) : block.block_type)}
        </p>
        {block.delay_days !== undefined && block.delay_days > 0 && (
          <p className="text-xs text-muted-foreground">
            +{block.delay_days} {t('templates.days')}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        {block.is_required && (
          <Badge variant="outline" className="text-xs">
            {t('templates.required')}
          </Badge>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onConfigure}>
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function PartnerTemplateBuilder({ template, onSave, onCancel }: PartnerTemplateBuilderProps) {
  const { t } = useTranslation();
  
  // Form state
  const [name, setName] = useState(template?.name || '');
  const [description, setDescription] = useState(template?.description || '');
  const [category, setCategory] = useState<PartnerTemplate['category']>(template?.category || 'custom');
  const [isActive, setIsActive] = useState(template?.is_active ?? true);
  const [isDefault, setIsDefault] = useState(template?.is_default ?? false);
  const [blocks, setBlocks] = useState<TemplateBlockConfig[]>(template?.blocks || []);
  
  // UI state
  const [showBlockPicker, setShowBlockPicker] = useState(false);
  const [editingBlock, setEditingBlock] = useState<TemplateBlockConfig | null>(null);

  // DnD setup
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = blocks.findIndex(b => b.id === active.id);
      const newIndex = blocks.findIndex(b => b.id === over.id);
      
      const newBlocks = [...blocks];
      const [removed] = newBlocks.splice(oldIndex, 1);
      newBlocks.splice(newIndex, 0, removed);
      
      // Update order numbers
      setBlocks(newBlocks.map((b, i) => ({ ...b, order: i })));
    }
  };

  const handleAddBlock = (libraryEntry: BlockLibraryEntry) => {
    const newBlock: TemplateBlockConfig = {
      id: crypto.randomUUID(),
      block_type: libraryEntry.block_type,
      order: blocks.length,
      is_required: false,
    };
    setBlocks([...blocks, newBlock]);
    setShowBlockPicker(false);
  };

  const handleRemoveBlock = (blockId: string) => {
    setBlocks(blocks.filter(b => b.id !== blockId).map((b, i) => ({ ...b, order: i })));
  };

  const handleUpdateBlock = (updatedBlock: TemplateBlockConfig) => {
    setBlocks(blocks.map(b => b.id === updatedBlock.id ? updatedBlock : b));
    setEditingBlock(null);
  };

  const handleSave = () => {
    onSave({
      name,
      description,
      category,
      is_active: isActive,
      is_default: isDefault,
      blocks,
    });
  };

  const categories = ['meeting', 'questionnaire', 'consent', 'info', 'action'] as const;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {template ? t('templates.editTemplate') : t('templates.createTemplate')}
          </h2>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Template metadata */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('templates.name')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('templates.namePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('templates.description')}</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('templates.descriptionPlaceholder')}
                className="min-h-[60px]"
              />
            </div>

            <div className="space-y-2">
              <Label>{t('templates.category')}</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as PartnerTemplate['category'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="onboarding">{t('templates.categoryOnboarding')}</SelectItem>
                  <SelectItem value="follow_up">{t('templates.categoryFollowUp')}</SelectItem>
                  <SelectItem value="assessment">{t('templates.categoryAssessment')}</SelectItem>
                  <SelectItem value="custom">{t('templates.categoryCustom')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('templates.isActive')}</Label>
                <p className="text-xs text-muted-foreground">{t('templates.isActiveDesc')}</p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('templates.isDefault')}</Label>
                <p className="text-xs text-muted-foreground">{t('templates.isDefaultDesc')}</p>
              </div>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            </div>
          </div>

          {/* Blocks */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{t('templates.blocks')}</Label>
              <Button variant="outline" size="sm" onClick={() => setShowBlockPicker(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t('templates.addBlock')}
              </Button>
            </div>

            {blocks.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-muted-foreground">
                  <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t('templates.noBlocks')}</p>
                  <p className="text-xs">{t('templates.noBlocksHint')}</p>
                </CardContent>
              </Card>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {blocks.map((block) => (
                      <SortableBlock
                        key={block.id}
                        block={block}
                        libraryEntry={BLOCK_LIBRARY.find(l => l.block_type === block.block_type)}
                        onRemove={() => handleRemoveBlock(block.id)}
                        onConfigure={() => setEditingBlock(block)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-4 border-t border-border flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSave} disabled={!name.trim() || blocks.length === 0}>
          {t('common.save')}
        </Button>
      </div>

      {/* Block picker sheet */}
      <Sheet open={showBlockPicker} onOpenChange={setShowBlockPicker}>
        <SheetContent side="right" className="w-[400px] sm:max-w-[400px]">
          <SheetHeader>
            <SheetTitle>{t('templates.selectBlock')}</SheetTitle>
          </SheetHeader>
          
          <ScrollArea className="h-[calc(100vh-100px)] mt-4">
            <div className="space-y-6 pr-4">
              {categories.map((cat) => {
                const categoryBlocks = getBlocksByCategory(cat);
                if (categoryBlocks.length === 0) return null;
                
                return (
                  <div key={cat}>
                    <h4 className="text-sm font-medium mb-2 capitalize">
                      {t(`templates.category.${cat}`)}
                    </h4>
                    <div className="space-y-2">
                      {categoryBlocks.map((entry) => {
                        const Icon = iconMap[entry.icon] || ClipboardList;
                        return (
                          <button
                            key={entry.block_type}
                            onClick={() => handleAddBlock(entry)}
                            className={cn(
                              'w-full flex items-start gap-3 p-3 rounded-lg border text-left hover:bg-muted/50 transition-colors',
                              categoryColors[cat]
                            )}
                          >
                            <div className="p-1.5 rounded-md bg-background">
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm">{t(entry.name_key)}</p>
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {t(entry.description_key)}
                              </p>
                              {entry.requires_consent && (
                                <Badge variant="outline" className="mt-1 text-xs">
                                  {t('templates.requiresConsent')}
                                </Badge>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Block config sheet */}
      <Sheet open={!!editingBlock} onOpenChange={(open) => !open && setEditingBlock(null)}>
        <SheetContent side="right" className="w-[400px] sm:max-w-[400px]">
          <SheetHeader>
            <SheetTitle>{t('templates.configureBlock')}</SheetTitle>
          </SheetHeader>
          
          {editingBlock && (
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>{t('templates.customTitle')}</Label>
                <Input
                  value={editingBlock.custom_title || ''}
                  onChange={(e) => setEditingBlock({ ...editingBlock, custom_title: e.target.value || undefined })}
                  placeholder={t('templates.customTitlePlaceholder')}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('templates.delayDays')}</Label>
                <Input
                  type="number"
                  min={0}
                  value={editingBlock.delay_days || 0}
                  onChange={(e) => setEditingBlock({ ...editingBlock, delay_days: parseInt(e.target.value) || 0 })}
                />
                <p className="text-xs text-muted-foreground">
                  {t('templates.delayDaysHint')}
                </p>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t('templates.blockRequired')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('templates.blockRequiredHint')}
                  </p>
                </div>
                <Switch
                  checked={editingBlock.is_required}
                  onCheckedChange={(checked) => setEditingBlock({ ...editingBlock, is_required: checked })}
                />
              </div>

              <div className="pt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditingBlock(null)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={() => handleUpdateBlock(editingBlock)}>
                  {t('common.apply')}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
