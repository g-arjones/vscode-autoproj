import { host, WorkspaceBuilder } from "./helpers";
import { UsingResult } from "./using";

export const workspaceBuilderRegistry: WorkspaceBuilder[] = [];
export const usingResultRegistry: UsingResult[] = [];

afterEach(async () => {
    while (usingResultRegistry.length > 0) {
        usingResultRegistry.pop()?.rollback();
    }
    await host.resetFolders();
    while (workspaceBuilderRegistry.length > 0) {
        workspaceBuilderRegistry.pop()?.clear();
    }
});