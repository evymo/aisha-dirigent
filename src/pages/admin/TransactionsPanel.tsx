import { useState } from "react";
import { getTranslationLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAllTokenTransactions } from "@/hooks/useTokens";
import { Loader2, Coins } from "lucide-react";
import { TOKEN_ICONS, TOKEN_COLORS } from "./tokenomics-constants";

export function TransactionsPanel() {
    const { t, i18n } = useTranslation();
    const lang = getTranslationLocale(i18n.language);
    const [txFilter, setTxFilter] = useState<{ tokenType?: string; referenceType?: string }>({});

    const { data: transactions, isLoading: txLoading } = useAllTokenTransactions({
        ...txFilter,
        limit: 200,
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle>{t("admin.tokenomics.transactionsTitle")}</CardTitle>
                <CardDescription>{t("admin.tokenomics.transactionsDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex gap-4 mb-4">
                    <div className="flex-1">
                        <Label className="mb-2 block">{t("admin.tokenomics.filterByToken")}</Label>
                        <Select
                            value={txFilter.tokenType || "all"}
                            onValueChange={(value) => setTxFilter({ ...txFilter, tokenType: value === "all" ? undefined : value })}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t("common.all")}</SelectItem>
                                <SelectItem value="governance">{t("tokens.types.governance")}</SelectItem>
                                <SelectItem value="impact">{t("tokens.types.impact")}</SelectItem>
                                <SelectItem value="data">{t("tokens.types.data")}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex-1">
                        <Label className="mb-2 block">{t("admin.tokenomics.filterByAction")}</Label>
                        <Select
                            value={txFilter.referenceType || "all"}
                            onValueChange={(value) => setTxFilter({ ...txFilter, referenceType: value === "all" ? undefined : value })}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{t("common.all")}</SelectItem>
                                <SelectItem value="daily_checkin">{t("admin.tokenomics.actions.daily_checkin")}</SelectItem>
                                <SelectItem value="lab_result">{t("admin.tokenomics.actions.lab_result")}</SelectItem>
                                <SelectItem value="study_registration">{t("admin.tokenomics.actions.study_registration")}</SelectItem>
                                <SelectItem value="referral">{t("admin.tokenomics.actions.referral")}</SelectItem>
                                <SelectItem value="health_document">{t("admin.tokenomics.actions.health_document")}</SelectItem>
                                <SelectItem value="qualification_test">{t("admin.tokenomics.actions.qualification_test")}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {txLoading ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                ) : !transactions?.length ? (
                    <p className="text-center text-muted-foreground py-8">
                        {t("admin.tokenomics.noTransactions")}
                    </p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t("admin.tokenomics.date")}</TableHead>
                                <TableHead>{t("admin.tokenomics.token")}</TableHead>
                                <TableHead>{t("admin.tokenomics.type")}</TableHead>
                                <TableHead>{t("admin.tokenomics.action")}</TableHead>
                                <TableHead className="text-right">{t("admin.tokenomics.amount")}</TableHead>
                                <TableHead className="text-right">{t("admin.tokenomics.balance")}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {transactions.map((tx) => {
                                const Icon = TOKEN_ICONS[tx.token_type] || Coins;
                                const colorClass = TOKEN_COLORS[tx.token_type] || "text-primary";
                                return (
                                    <TableRow key={tx.id}>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {new Date(tx.created_at).toLocaleString(lang)}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Icon className={`w-4 h-4 ${colorClass}`} />
                                                <span className="capitalize">{tx.token_type}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="capitalize">
                                                {tx.transaction_type}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-sm">{tx.reference_type || tx.description || "-"}</span>
                                        </TableCell>
                                        <TableCell className={`text-right font-medium ${tx.amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                                            {tx.amount >= 0 ? "+" : ""}{tx.amount}
                                        </TableCell>
                                        <TableCell className="text-right text-muted-foreground">
                                            {tx.balance_after}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}
