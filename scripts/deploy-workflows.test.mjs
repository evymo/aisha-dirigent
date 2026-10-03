/**
 * deploy-workflows: aktivuje jen workflowy se spouštěčem a nenahraje workflow,
 * jehož pověření nikdo nezaložil.
 *
 * ⛔ NAMĚŘENO 2026-09-18 (guru): 4 podworkflowy (executeWorkflowTrigger) padaly
 * při aktivaci „has no node to start the workflow" a nasazení je počítalo jako
 * selhání; odkazy na nezaložená pověření zůstávaly `__REMAP__` a n8n je hlásil
 * až za běhu („Credential with ID __REMAP__ does not exist").
 */
import { describe, expect, test } from "vitest";
import { maSpoustec, nepremapovane, roztridNepremapovane } from "./deploy-workflows.mjs";

const wf = (...nodes) => ({ nodes });

describe("deploy-workflows: spouštěč a pověření", () => {
  test("podworkflow (executeWorkflowTrigger) ani manuální/chybový start se neaktivují", () => {
    expect(maSpoustec(wf({ type: "n8n-nodes-base.executeWorkflowTrigger" }))).toBe(false);
    expect(maSpoustec(wf({ type: "n8n-nodes-base.manualTrigger" }, { type: "n8n-nodes-base.errorTrigger" }))).toBe(false);
  });

  test("cron, webhook, RabbitMQ i vlastní trigger aktivovat jde; vypnutý uzel se nepočítá", () => {
    expect(maSpoustec(wf({ type: "n8n-nodes-base.scheduleTrigger" }))).toBe(true);
    expect(maSpoustec(wf({ type: "n8n-nodes-base.webhook" }))).toBe(true);
    expect(maSpoustec(wf({ type: "n8n-nodes-base.rabbitmqTrigger" }))).toBe(true);
    expect(maSpoustec(wf({ type: "n8n-nodes-aisha.aishaTrigger" }))).toBe(true);
    expect(maSpoustec(wf({ type: "n8n-nodes-base.scheduleTrigger", disabled: true }))).toBe(false);
  });

  test("⛔ odkaz mimo mapu pověření (__REMAP__ i cizí id z exportu) je nález", () => {
    const mapa = new Map([["httpHeaderAuth::A", "10"]]);
    const w = wf(
      { credentials: { httpHeaderAuth: { id: "10", name: "A" } } },
      { credentials: { rabbitmq: { id: "__REMAP__", name: "RabbitMQ" } } },
      { credentials: { openAiApi: { id: "cizi-instance-1", name: "OpenAi account" } } },
    );
    expect(nepremapovane(w, mapa)).toEqual(["rabbitmq::RabbitMQ", "openAiApi::OpenAi account"]);
  });

  test("⛔ volitelné pověření (v mapě null) workflow nezahodí — nahraje se neaktivní; chybějící je selhání", () => {
    const mapa = new Map([["httpHeaderAuth::A", "10"], ["githubApi::GitHub account", null]]);
    const w = wf(
      { credentials: { httpHeaderAuth: { id: "__REMAP__", name: "A" } } },
      { credentials: { githubApi: { id: "__REMAP__", name: "GitHub account" } } },
      { credentials: { rabbitmq: { id: "__REMAP__", name: "RabbitMQ" } } },
    );
    // A přemapuje deploy (id z mapy), tady ještě __REMAP__ → nepřemapované i s ním
    const { volitelna, chybejici } = roztridNepremapovane(w, mapa);
    expect(volitelna).toEqual(["githubApi::GitHub account"]);
    expect(chybejici).toEqual(["httpHeaderAuth::A", "rabbitmq::RabbitMQ"]);
  });
});
