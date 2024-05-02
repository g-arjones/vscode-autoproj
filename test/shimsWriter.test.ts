import * as path from "path";
import { Workspace } from "../src/autoproj";
import { ShimsWriter } from "../src/shimsWriter";
import * as helpers from "./helpers";
import { accessSync, constants } from "fs";

describe("ShimsWriter instanciated", () => {
    const subject = new ShimsWriter();
    let root: string;
    let workspace: Workspace;

    beforeEach(async () => {
        root = helpers.init();
        helpers.mkdir(".autoproj");
        helpers.mkfile("", ".autoproj", "installation-manifest");
        workspace = Workspace.fromDir(root, false)!;
        helpers.registerDir(ShimsWriter.RELATIVE_SHIMS_PATH, "..");
        helpers.registerDir(ShimsWriter.RELATIVE_SHIMS_PATH);
    });
    afterEach(() => {
        helpers.clear();
    });
    describe("writePython", () => {
        let relativeShimPath: string;
        beforeEach(() => {
            relativeShimPath = path.join(ShimsWriter.RELATIVE_SHIMS_PATH, "python");
            helpers.registerFile(relativeShimPath);
        });
        it("writes python shim in the given workspace", async () => {
            await subject.writePython(workspace);
            accessSync(path.join(root, relativeShimPath), constants.X_OK);
        });
    });
    describe("writeGdb", () => {
        let relativeShimPath: string;
        beforeEach(() => {
            relativeShimPath = path.join(ShimsWriter.RELATIVE_SHIMS_PATH, "gdb");
            helpers.registerFile(relativeShimPath);
        });
        it("writes gdb shim in the given workspace", async () => {
            await subject.writeGdb(workspace);
            accessSync(path.join(root, relativeShimPath), constants.X_OK);
        });
    });
    describe("writeRuby", () => {
        let relativeShimPath: string;
        beforeEach(() => {
            relativeShimPath = path.join(ShimsWriter.RELATIVE_SHIMS_PATH, "ruby");
            helpers.registerFile(relativeShimPath);
        });
        it("writes ruby shim in the given workspace", async () => {
            await subject.writeRuby(workspace);
            accessSync(path.join(root, relativeShimPath), constants.X_OK);
        });
    });
});