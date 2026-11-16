import functions from "@google-cloud/functions-framework";
import { handle } from "./kill-switch.mjs";

functions.cloudEvent("killSwitch", (event) => handle(event));
