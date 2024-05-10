import { LogOutputChannel } from "vscode";
import { getLogger } from "../src/logging"
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