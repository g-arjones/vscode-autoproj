import * as assert from "assert";
import * as path from "path";
import { CompilationDatabase } from "../src/compilationDatabase";
import { Mocks, WorkspaceBuilder } from "./helpers";
import { fs } from "../src/cmt/pr";
import { using } from "./using";
import { It, Times } from "typemoq";

describe("CompilationDatabase", () => {
    let builder: WorkspaceBuilder;
    let subject: CompilationDatabase;
    let dbPath: string;
    beforeEach(() => {
        builder = new WorkspaceBuilder();
        dbPath = path.join(builder.root, "build", "compile_commands.json");
        builder.fs.mkdir("build");
        builder.fs.registerFile("build", "compile_commands.json");
        subject = new CompilationDatabase(dbPath);
    });
    afterEach(() => {
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
            const mocks = new Mocks();
            await using(mocks.showErrorMessage).do(async () => await subject.load());
            mocks.showErrorMessage.verify((x) => x(It.isAnyString()), Times.once());
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
            builder.fs.rmdir("build");
            await event;

            // recreate directory and file
            event = createEvent();
            await fs.mkdir(path.join(builder.root, "build"));
            await fs.writeFile(dbPath, "{}");
            await event;
        });
        it("fires event when build dir is created", async () => {
            builder.fs.rmdir("build");
            subject.dispose();
            subject = new CompilationDatabase(dbPath);

            const event = createEvent();
            await fs.mkdir(path.join(builder.root, "build"));
            await fs.writeFile(dbPath, "{}");
            await event;
        });
        it("fires event when db is moved off", async () => {
            await fs.writeFile(dbPath, "{}");
            subject.dispose();
            subject = new CompilationDatabase(dbPath);

            const event = createEvent();
            builder.fs.registerDir("build2");
            builder.fs.registerFile("build2", "compile_commands.json");
            await fs.rename(path.join(builder.root, "build"), path.join(builder.root, "build2"));
            await event;
        });
        it("fires event when db is moved on", async () => {
            await fs.writeFile(dbPath, "{}");
            builder.fs.registerDir("build2");
            builder.fs.registerFile("build2", "compile_commands.json");
            await fs.rename(path.join(builder.root, "build"), path.join(builder.root, "build2"));

            subject.dispose();
            subject = new CompilationDatabase(dbPath);

            const event = createEvent();
            await fs.rename(path.join(builder.root, "build2"), path.join(builder.root, "build"));
            await event;
        });
    });
});