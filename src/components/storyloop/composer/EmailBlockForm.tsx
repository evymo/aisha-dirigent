/**
 * Email Block Form
 * 
 * Compose and send an email to a user, creating a story entry.
 * The email is dispatched server-side via the entry metadata.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail, Send } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmailBlockFormProps {
    onSubmit: (metadata: Record<string, unknown>, content?: string) => Promise<void>;
    onCancel: () => void;
    isPending: boolean;
    userEmail?: string | null;
}

export function EmailBlockForm({ onSubmit, onCancel, isPending, userEmail }: EmailBlockFormProps) {
    const { t } = useTranslation();
    const [to, setTo] = useState(userEmail ?? '');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');

    const isValid = to.trim().length > 0 && subject.trim().length > 0 && body.trim().length > 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isValid) return;

        await onSubmit(
            {
                type: 'email',
                to: to.trim(),
                subject: subject.trim(),
                send_as_email: true,
            },
            body.trim()
        );
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* Recipient */}
            <div className="space-y-1.5">
                <Label htmlFor="email-to" className="flex items-center gap-1.5 text-sm">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    {t('storyloop.email.to')}
                </Label>
                <Input
                    id="email-to"
                    type="email"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    placeholder={t('storyloop.email.toPlaceholder')}
                    className="h-9"
                    disabled={!!userEmail}
                />
            </div>

            {/* Subject */}
            <div className="space-y-1.5">
                <Label htmlFor="email-subject" className="text-sm">
                    {t('storyloop.email.subject')}
                </Label>
                <Input
                    id="email-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={t('storyloop.email.subjectPlaceholder')}
                    className="h-9"
                />
            </div>

            {/* Body */}
            <div className="space-y-1.5">
                <Label htmlFor="email-body" className="text-sm">
                    {t('storyloop.email.body')}
                </Label>
                <Textarea
                    id="email-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={t('storyloop.email.bodyPlaceholder')}
                    className="min-h-[140px] resize-none"
                />
            </div>

            {/* Actions */}
            <div className={cn('flex items-center justify-end gap-2 pt-2')}>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
                    {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={!isValid || isPending} className="gap-1.5">
                    <Send className="h-3.5 w-3.5" />
                    {t('storyloop.email.send')}
                </Button>
            </div>
        </form>
    );
}
