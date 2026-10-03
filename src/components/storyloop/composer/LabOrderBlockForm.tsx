/**
 * Lab Order Block Form
 *
 * Form for creating a lab order entry.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LabOrderMetadata } from '@/schemas/storyLoopSchemas';
import { getLabTestsCatalog } from '@/lib/lab-tests';
import type { LabTestDefinition } from '@/schemas/labTestSchemas';

interface LabOrderBlockFormProps {
  onSubmit: (metadata: Omit<LabOrderMetadata, 'type'>, content?: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}

const labStatuses = ['ordered', 'scheduled', 'completed', 'results_ready', 'reviewed'] as const;
const presetIds = [
  'custom',
  'respiratory_baseline',
  'respiratory_extension',
  'respiratory_immunity',
  'respiratory_metabolic',
  'respiratory_endocrine',
] as const;

type RespiratoryPresetId = typeof presetIds[number];

const respiratoryPresets: Record<Exclude<RespiratoryPresetId, 'custom'>, string[]> = {
  respiratory_baseline: ['CBC', 'HS_CRP', 'ESR', 'FERRITIN'],
  respiratory_extension: ['FIBRINOGEN', 'SAA'],
  respiratory_immunity: ['CD3_CD4_CD8', 'LYMPHOCYTE_PANEL'],
  respiratory_metabolic: ['HBA1C', 'CYSTATIN_C', 'HOMOCYSTEINE'],
  respiratory_endocrine: ['TSH', 'FT4'],
};

export function LabOrderBlockForm({ onSubmit, onCancel, isPending }: LabOrderBlockFormProps) {
  const { t } = useTranslation();
  const [labName, setLabName] = useState('');
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [selectedCatalogCode, setSelectedCatalogCode] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<RespiratoryPresetId>('custom');
  const [scheduledDate, setScheduledDate] = useState('');
  const [status, setStatus] = useState<typeof labStatuses[number]>('ordered');
  const labCatalog = useMemo(() => getLabTestsCatalog(), []);
  const catalogByCode = useMemo(
    () =>
      new Map<string, LabTestDefinition>(
        labCatalog.tests.map((test) => [test.code, test] as const)
      ),
    [labCatalog.tests]
  );
  const availableTests = useMemo(
    () =>
      [...labCatalog.tests].sort((a, b) =>
        t(a.name_key).localeCompare(t(b.name_key))
      ),
    [labCatalog.tests, t]
  );

  const addTest = (code: string) => {
    if (!code) return;
    setSelectedTests((current) => (current.includes(code) ? current : [...current, code]));
  };

  const removeTest = (code: string) => {
    setSelectedTests((current) => current.filter((value) => value !== code));
  };

  const applyPreset = (presetId: RespiratoryPresetId) => {
    setSelectedPreset(presetId);
    if (presetId === 'custom') return;

    const presetTests = respiratoryPresets[presetId].filter((code) => catalogByCode.has(code));
    setSelectedTests((current) => {
      const next = new Set(current);
      presetTests.forEach((code) => next.add(code));
      return Array.from(next);
    });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    if (selectedTests.length === 0) return;

    const metadata: Omit<LabOrderMetadata, 'type'> = {
      tests: selectedTests,
      status,
      ...(labName.trim() ? { lab_name: labName.trim() } : {}),
      ...(scheduledDate ? { scheduled_date: new Date(scheduledDate).toISOString() } : {}),
    };

    onSubmit(metadata, t('storyloop.labOrder'));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>{t('storyloop.labOrder')}</Label>
        <Input
          value={labName}
          onChange={(event) => setLabName(event.target.value)}
          placeholder={t('common.optional')}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('storyloop.orderedTests')}</Label>
        <Select value={selectedPreset} onValueChange={(value) => applyPreset(value as RespiratoryPresetId)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presetIds.map((presetId) => (
              <SelectItem key={presetId} value={presetId}>
                {t(`storyloop.labPreset.${presetId}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{t('storyloop.selectLabTest')}</Label>
        <div className="flex gap-2">
          <Select value={selectedCatalogCode} onValueChange={setSelectedCatalogCode}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('storyloop.selectLabTest')} />
            </SelectTrigger>
            <SelectContent>
              {availableTests.map((test) => (
                <SelectItem key={test.code} value={test.code}>
                  {t(test.name_key)} ({test.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              addTest(selectedCatalogCode);
              setSelectedCatalogCode('');
            }}
            disabled={!selectedCatalogCode}
          >
            {t('storyloop.addTest')}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t('storyloop.selectedTests')}</Label>
        {selectedTests.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('storyloop.noTestsSelected')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedTests.map((code) => (
              <Badge key={code} variant="secondary" className="gap-2">
                <span>{t(catalogByCode.get(code)?.name_key ?? code)} ({code})</span>
                <button
                  type="button"
                  className="text-xs underline underline-offset-2"
                  onClick={() => removeTest(code)}
                >
                  {t('common.delete')}
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>{t('storyloop.scheduledFor')}</Label>
        <Input
          type="date"
          value={scheduledDate}
          onChange={(event) => setScheduledDate(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>{t('common.status')}</Label>
        <Select value={status} onValueChange={(value) => setStatus(value as typeof labStatuses[number])}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {labStatuses.map((item) => (
              <SelectItem key={item} value={item}>
                {t(`storyloop.labStatus.${item}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={isPending || selectedTests.length === 0}>
          {t('common.create')}
        </Button>
      </div>
    </form>
  );
}
