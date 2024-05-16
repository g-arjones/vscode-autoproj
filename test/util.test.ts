import { LogOutputChannel } from "vscode";
import { asyncSpawn, getLogger, isSubdirOf } from "../src/util"
import { IMock, Mock, Times } from "typemoq";
import * as assert from "assert";

describe("getLogger()", () => {
    let logger: LogOutputChannel;
    let mockChannel: IMock<LogOutputChannel>;
    beforeEach(() => {
        mockChannel = Mock.ofType<LogOutputChannel>();
        logger = getLogger(mockChannel.object, "ws");
    });
    it("appends a prefix to all logging messages", () => {
        logger.append("foobar");
        logger.appendLine("foobar");
        logger.trace("foobar");
        logger.debug("foobar");
        logger.info("foobar");
        logger.warn("foobar");
        logger.error("foobar");
        logger.replace("foobar");

        mockChannel.verify((x) => x.append("[ws] foobar"), Times.once());
        mockChannel.verify((x) => x.appendLine("[ws] foobar"), Times.once());
        mockChannel.verify((x) => x.trace("[ws] foobar"), Times.once());
        mockChannel.verify((x) => x.debug("[ws] foobar"), Times.once());
        mockChannel.verify((x) => x.info("[ws] foobar"), Times.once());
        mockChannel.verify((x) => x.warn("[ws] foobar"), Times.once());
        mockChannel.verify((x) => x.error("[ws] foobar"), Times.once());
        mockChannel.verify((x) => x.replace("[ws] foobar"), Times.once());
    });
    it("does not override other methods", () => {
        const logger = getLogger(mockChannel.object, "ws");
        mockChannel.setup((x) => x.name).returns(() => "foobar");
        assert.equal(logger.name, "foobar");
    });
});

describe("asyncSpawn()", () => {
    let mockChannel: IMock<LogOutputChannel>;
    beforeEach(() => {
        mockChannel = Mock.ofType<LogOutputChannel>();
    });
    it("throws if execution fails", async () => {
        const execution = asyncSpawn(mockChannel.object, "/foo/bar");
        await assert.rejects(execution.returnCode, /ENOENT/)
    });
    it("resolves to process return code", async () => {
        let execution = asyncSpawn(mockChannel.object, "/bin/sh", ["-c", "exit 0"]);
        assert.equal(await execution.returnCode, 0);

        execution = asyncSpawn(mockChannel.object, "/bin/sh", ["-c", "exit 10"]);
        assert.equal(await execution.returnCode, 10);
    });
    it("trims and splits output", async () => {
        let execution = asyncSpawn(mockChannel.object, "/bin/sh", ["-c",
            'printf "one\ntwo\n" >&2 && printf "three\nfour\n"'
        ]);

        await execution.returnCode;
        mockChannel.verify((x) => x.error("one"), Times.once());
        mockChannel.verify((x) => x.error("two"), Times.once());
        mockChannel.verify((x) => x.info("three"), Times.once());
        mockChannel.verify((x) => x.info("four"), Times.once());
    });
});

describe("isSubdirOf()", () => {
    it("returns true if dir is a subpath or equal to another", () => {
        assert(isSubdirOf("/path/to/file", "/path/to////"));
        assert(isSubdirOf("/path/to/dir", "/path/to////"));
        assert(isSubdirOf("/path/to/dir", "/path/to"));
        assert(isSubdirOf("/path/to", "/path/to///"));
        assert(isSubdirOf("/path/to//", "/path/to"));

        assert(!isSubdirOf("/path/to_", "/path/to"));
        assert(!isSubdirOf("/path/t", "/path/to"));
    })
});
