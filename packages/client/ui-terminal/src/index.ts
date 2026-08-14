/**
 * Terminal surface plugin, node half. Pure UI plugin: the browser half ships
 * through the package.json `dsh.client` declaration and `exports["./client"]`;
 * the node half stays empty so the plugin loads in host cordis.yml rosters.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
