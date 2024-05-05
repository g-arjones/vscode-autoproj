import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { CompilationDatabase } from "../src/compilationDatabase";
import * as helpers from "./helpers";
import { fs } from "../src/cmt/pr";
import { using } from "./using";
import { GlobalMock, It, Times } from "typemoq";

describe("CompilationDatabase", () => {
    let root: string;
    let subject: CompilationDatabase;
    let dbPath: string;
    beforeEach(() => {
        root = helpers.init();
        dbPath = path.join(root, "build", "compile_commands.json");
        helpers.mkdir("build");
        helpers.registerFile("build", "compile_commands.json");
        subject = new CompilationDatabase(dbPath);
    });
    afterEach(() => {
        helpers.clear();
        subject.dispose();
    });
    it("is not loaded after instantiation", () => {
        assert.equal(subject.loaded, false);
    });
    describe("exists()", () => {
        it("returns false if db does not exist on disk", async () => {
            assert.equal(await subject.exists(), false);
        });
        it("returns true if db does exist on disk", async () => {
            await fs.writeFile(dbPath, "{}");
            assert.equal(await subject.exists(), true);
        });
    });
    describe("load()", () => {
        it("shows an error message if loading fails", async () => {
            const mock = GlobalMock.ofInstance(vscode.window.showErrorMessage, "showErrorMessage", vscode.window);
            await using(mock).do(async () => await subject.load());
            mock.verify((x) => x(It.isAnyString()), Times.once());
        });
    });
    describe("onChange()", () => {
        let originalInterval: number;
        beforeEach(() => {
            originalInterval = CompilationDatabase.POLLING_INTERVAL;
            CompilationDatabase.POLLING_INTERVAL = 10;

            subject.dispose();
            subject = new CompilationDatabase(dbPath);
        })
        afterEach(() => {
            CompilationDatabase.POLLING_INTERVAL = originalInterval;
        })
        function createEvent() {
            return new Promise<void>((resolve) => subject.onChange(() => resolve()));
        }
        it("fires event when db is created on disk", async () => {
            const event = createEvent();
            await fs.writeFile(dbPath, "{}");
            await event;
        });
        it("fires event when db is deleted from disk", async () => {
            await fs.writeFile(dbPath, "{}");

            subject.dispose();
            subject = new CompilationDatabase(dbPath);

            const event = createEvent();
            await fs.unlink(dbPath);
            await event;
        });
        it("fires event when db is deleted and then recreated", async () => {
            await fs.writeFile(dbPath, "{}");

            subject.dispose();
            subject = new CompilationDatabase(dbPath);

            let event = createEvent();
            await fs.unlink(dbPath);
            await event;

            event = createEvent();
            await fs.writeFile(dbPath, "{}");
            await event;
        });
        it("fires event when build dir is removed and then recreated", async () => {
            // wait until subject is aware the db exists
            let event = createEvent();
            await fs.writeFile(dbPath, "{}");
            await event;

            // remove the file and directory and wait for subject to acknowledge it
            event = createEvent();
            await fs.unlink(dbPath);
            helpers.rmdir("build");
            await event;

            // recreate directory and file
            event = createEvent();
            await fs.mkdir(path.join(root, "build"));
            await fs.writeFile(dbPath, "{}");
            await event;
        });
        it("fires event when build dir is created", async () => {
            helpers.rmdir("build");
            subject.dispose();
            subject = new CompilationDatabase(dbPath);

            const event = createEvent();
            await fs.mkdir(path.join(root, "build"));
            await fs.writeFile(dbPath, "{}");
            await event;
        });
        it("fires event when db is moved off", async () => {
            await fs.writeFile(dbPath, "{}");
            subject.dispose();
            subject = new CompilationDatabase(dbPath);

            const event = createEvent();
            helpers.registerDir("build2");
            helpers.registerFile("build2", "compile_commands.json");
            await fs.rename(path.join(root, "build"), path.join(root, "build2"));
            await event;
        });
        it("fires event when db is moved on", async () => {
            await fs.writeFile(dbPath, "{}");
            helpers.registerDir("build2");
            helpers.registerFile("build2", "compile_commands.json");
            await fs.rename(path.join(root, "build"), path.join(root, "build2"));

            subject.dispose();
            subject = new CompilationDatabase(dbPath);

            const event = createEvent();
            await fs.rename(path.join(root, "build2"), path.join(root, "build"));
            await event;
        });
    });
});