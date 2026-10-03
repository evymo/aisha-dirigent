/**
 * @fileoverview Entity-to-protocol mapping table for IoT integration.
 */

import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { HomeAssistantEntityLink } from "@/hooks";

import { NONE_OPTION_VALUE, READING_TYPE_OPTIONS } from "./iotUtils";
import type { IotSyncStateReturn } from "./useIotSyncState";

interface IotEntityLinksTableProps {
  entityLinks: Record<string, HomeAssistantEntityLink>;
  equipment: IotSyncStateReturn["equipment"];
  locations: IotSyncStateReturn["locations"];
  trackedEntities: string[];
  updateEntityLink: (entityId: string, patch: Partial<HomeAssistantEntityLink>) => void;
}

/** Table for mapping HA entities to equipment, location, sensor code, etc. */
export default function IotEntityLinksTable({
  entityLinks,
  equipment,
  locations,
  trackedEntities,
  updateEntityLink,
}: IotEntityLinksTableProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("admin.production.flow.iot.entityLinks.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {trackedEntities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("admin.production.flow.iot.entityLinks.empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("admin.production.flow.iot.entityLinks.entityId")}</TableHead>
                <TableHead>{t("admin.production.flow.iot.entityLinks.sensorCode")}</TableHead>
                <TableHead>{t("admin.production.flow.iot.entityLinks.readingType")}</TableHead>
                <TableHead>{t("admin.production.flow.iot.entityLinks.unit")}</TableHead>
                <TableHead>{t("admin.production.flow.iot.entityLinks.equipment")}</TableHead>
                <TableHead>{t("admin.production.flow.iot.entityLinks.location")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trackedEntities.map((entityId) => {
                const link = entityLinks[entityId] ?? {};
                return (
                  <TableRow key={entityId}>
                    <TableCell className="font-mono text-xs">{entityId}</TableCell>
                    <TableCell>
                      <Input
                        value={link.sensorCode ?? ""}
                        onChange={(event) =>
                          updateEntityLink(entityId, {
                            sensorCode: event.target.value || undefined,
                          })
                        }
                        placeholder={t(
                          "admin.production.flow.iot.entityLinks.sensorCodePlaceholder",
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={link.readingType ?? NONE_OPTION_VALUE}
                        onValueChange={(nextValue) =>
                          updateEntityLink(entityId, {
                            readingType:
                              nextValue === NONE_OPTION_VALUE
                                ? undefined
                                : nextValue,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_OPTION_VALUE}>
                            {t("admin.production.flow.iot.config.none")}
                          </SelectItem>
                          {READING_TYPE_OPTIONS.map((readingType) => (
                            <SelectItem key={readingType} value={readingType}>
                              {t(
                                `admin.production.flow.iot.readingTypes.${readingType}`,
                              )}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={link.unit ?? ""}
                        onChange={(event) =>
                          updateEntityLink(entityId, {
                            unit: event.target.value || undefined,
                          })
                        }
                        placeholder={t(
                          "admin.production.flow.iot.entityLinks.unitPlaceholder",
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={link.equipmentId ?? NONE_OPTION_VALUE}
                        onValueChange={(nextValue) =>
                          updateEntityLink(entityId, {
                            equipmentId:
                              nextValue === NONE_OPTION_VALUE
                                ? undefined
                                : nextValue,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_OPTION_VALUE}>
                            {t("admin.production.flow.iot.config.none")}
                          </SelectItem>
                          {equipment?.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.asset_tag}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={link.locationId ?? NONE_OPTION_VALUE}
                        onValueChange={(nextValue) =>
                          updateEntityLink(entityId, {
                            locationId:
                              nextValue === NONE_OPTION_VALUE
                                ? undefined
                                : nextValue,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_OPTION_VALUE}>
                            {t("admin.production.flow.iot.config.none")}
                          </SelectItem>
                          {locations?.map((location) => (
                            <SelectItem key={location.id} value={location.id}>
                              {location.location_code}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
