import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSupportedLanguages } from '@/hooks/useSupportedLanguages';
import { LocaleFlag } from '@/components/common/LocaleFlag';

// Fallback for when DB is unavailable
const fallbackLanguages = [
  { code: 'en', label: 'English' },
  { code: 'cs', label: 'Čeština' },
];

type LanguageSwitcherProps = {
  onLanguageChanged?: (langCode: string) => void;
};

export function LanguageSwitcher({ onLanguageChanged }: LanguageSwitcherProps) {
  const { i18n } = useTranslation();
  const { data: supportedLanguages } = useSupportedLanguages(true);

  // Map DB languages to component format
  const languages = supportedLanguages && supportedLanguages.length > 0
    ? supportedLanguages.map(lang => ({
        code: lang.code,
        label: lang.name_native,
      }))
    : fallbackLanguages;

  const currentLanguage = languages.find((lang) => lang.code === i18n.language) || languages[0];

  const changeLanguage = (langCode: string) => {
    i18n.changeLanguage(langCode);
    onLanguageChanged?.(langCode);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-2"
          aria-label={`Change language (${currentLanguage.label})`}
        >
          <span><LocaleFlag code={currentLanguage.code} /></span>
          <span className="hidden sm:inline">{currentLanguage.label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => changeLanguage(lang.code)}
            className={lang.code === i18n.language ? 'bg-muted' : ''}
          >
            <span className="mr-2"><LocaleFlag code={lang.code} size="sm" /></span>
            {lang.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
