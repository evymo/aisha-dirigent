import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Trash2, ClipboardList } from "lucide-react";
import type { Questionnaire } from "./types";

interface QuestionnairesTableProps {
  questionnaires: Questionnaire[] | undefined;
  nameTranslations: Record<string, string>;
  onAdd: () => void;
  onEdit: (item: Questionnaire) => void;
  onDelete: (id: string) => void;
}

/**
 * Table listing all questionnaires with type, version, question count, and status.
 */
export function QuestionnairesTable({
  questionnaires,
  nameTranslations,
  onAdd,
  onEdit,
  onDelete,
}: QuestionnairesTableProps) {
  const { t } = useTranslation();
  const getQuestionnaireTypeLabel = (type: string) => {
    const key = `admin.questionnaires.questionnaireTypes.${type}`;
    const translated = t(key);
    return translated === key ? type : translated;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5" />
          {t("admin.questionnaires.allQuestionnaires")} ({questionnaires?.length || 0})
        </CardTitle>
        <Button onClick={onAdd} size="sm">
          <Plus className="h-4 w-4 mr-1" />
          {t("admin.questionnaires.addQuestionnaire")}
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("admin.questionnaires.table.name")}</TableHead>
              <TableHead>{t("admin.questionnaires.table.code")}</TableHead>
              <TableHead>{t("admin.questionnaires.table.type")}</TableHead>
              <TableHead>{t("admin.questionnaires.table.version")}</TableHead>
              <TableHead>{t("admin.questionnaires.table.questions")}</TableHead>
              <TableHead>{t("admin.questionnaires.table.status")}</TableHead>
              <TableHead className="text-right">{t("admin.questionnaires.table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {questionnaires?.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-medium">
                  {(item.name_key && nameTranslations[item.name_key]) || item.name}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{item.code}</Badge>
                </TableCell>
                <TableCell>
                  {item.questionnaire_type ? (
                    <Badge variant="outline" className="text-xs">
                      {getQuestionnaireTypeLabel(item.questionnaire_type)}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">&mdash;</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">v{item.version ?? 1}</Badge>
                </TableCell>
                <TableCell>
                  {typeof item.question_count === "number"
                    ? item.question_count
                    : Array.isArray(item.questions)
                      ? item.questions.length
                      : 0}{" "}
                  {t("admin.questionnaires.questionsCount")}
                </TableCell>
                <TableCell>
                  <Badge variant={item.is_active ? "default" : "secondary"}>
                    {item.is_active ? t("common.active") : t("common.inactive")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(item)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(item.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {questionnaires?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {t("admin.questionnaires.noQuestionnaires")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
