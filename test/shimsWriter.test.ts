import * as path from "path";
import { Workspace } from "../src/autoproj";
import { ShimsWriter } from "../src/shimsWriter";
import { TempFS } from "./helpers";
import { accessSync, constants } from "fs";

describe("ShimsWriter instanciated", () => {
    let tempfs: TempFS;
    let subject: ShimsWriter;
    let root: string;
    let workspace: Workspace;

    beforeEach(async () => {
        tempfs = new TempFS();
        root = tempfs.init();
        tempfs.mkdir(".autoproj");
        tempfs.mkfile("", ".autoproj", "installation-manifest");
        workspace = Workspace.fromDir(root, false)!;
        tempfs.registerDir(ShimsWriter.RELATIVE_SHIMS_PATH, "..");
        tempfs.registerDir(ShimsWriter.RELATIVE_SHIMS_PATH);
        subject = new ShimsWriter();
    });
    afterEach(() => {
        tempfs.clear();
    });
    describe("writePython", () => {
        let relativeShimPath: string;
        beforeEach(() => {
            relativeShimPath = path.join(ShimsWriter.RELATIVE_SHIMS_PATH, "python");
            tempfs.registerFile(relativeShimPath);
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
            tempfs.registerFile(relativeShimPath);
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
            tempfs.registerFile(relativeShimPath);
        });
        it("writes ruby shim in the given workspace", async () => {
            await subject.writeRuby(workspace);
            accessSync(path.join(root, relativeShimPath), constants.X_OK);
        });
    });
    describe("writeOps", () => {
        let relativeOptsPath: string;
        beforeEach(() => {
            relativeOptsPath = path.join(ShimsWriter.RELATIVE_OPTS_PATH, "rubyopt.rb");
            tempfs.registerFile(relativeOptsPath);
        });
        it("writes rubyopts.rb in the given workspace", async () => {
            await subject.writeOpts(workspace);
            accessSync(path.join(root, relativeOptsPath), constants.F_OK);
        });
    });
});