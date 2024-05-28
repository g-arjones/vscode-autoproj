import { install } from "source-map-support";

exports.mochaGlobalSetup = function() {
    install();
}