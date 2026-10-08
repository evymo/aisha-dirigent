import { dockerJSON } from './docker-http.js';
import { buildRunContainerBody, type RunContainerSpec } from './run-container-spec.js';

/**
 * Jediné volání `containers/create` v runneru. Tělo skládá výhradně
 * `buildRunContainerBody` (invarianty běhu); brána `beh-kontejneru-tvar` hlídá,
 * že jiný soubor runneru `containers/create` nevolá.
 */
export async function createRunContainer(apiBase: string, spec: RunContainerSpec): Promise<string> {
  const created = await dockerJSON<{ Id?: unknown }>('POST', `${apiBase}/containers/create`, buildRunContainerBody(spec));
  if (typeof created.Id !== 'string' || !created.Id) {
    throw new Error('Docker API containers/create nevrátil Id kontejneru');
  }
  return created.Id;
}
