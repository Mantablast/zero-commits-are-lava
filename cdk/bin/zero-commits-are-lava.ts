#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { ZeroCommitsAreLavaStack } from "../lib/zero-commits-are-lava-stack";

const app = new App();

new ZeroCommitsAreLavaStack(app, "ZeroCommitsAreLavaStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
