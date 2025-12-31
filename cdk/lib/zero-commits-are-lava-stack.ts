import path from "node:path";
import { Duration, RemovalPolicy, Stack, StackProps, CfnOutput } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

export class ZeroCommitsAreLavaStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const originAccessControl = new cloudfront.CfnOriginAccessControl(this, "SiteOAC", {
      originAccessControlConfig: {
        name: `${id}-oac`,
        originAccessControlOriginType: "s3",
        signingBehavior: "always",
        signingProtocol: "sigv4",
      },
    });

    const domainName = this.node.tryGetContext("route53Domain") || process.env.ROUTE53_DOMAIN;
    if (!domainName) {
      throw new Error("Missing required domain. Provide -c route53Domain=example.com or set ROUTE53_DOMAIN.");
    }
    const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName,
    });
    const certificate = new acm.DnsValidatedCertificate(this, "SiteCertificate", {
      domainName,
      hostedZone,
      region: "us-east-1",
      subjectAlternativeNames: [`www.${domainName}`],
    });

    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });

    const distribution = new cloudfront.Distribution(this, "SiteDistribution", {
      defaultBehavior: {
        origin: new origins.S3Origin(siteBucket),
        compress: true,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultRootObject: "index.html",
      enableLogging: false,
      domainNames: [domainName, `www.${domainName}`],
      certificate,
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(1),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(1),
        },
      ],
    });

    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride("DistributionConfig.Origins.0.OriginAccessControlId", originAccessControl.attrId);
    cfnDistribution.addPropertyOverride("DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity", "");

    siteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [siteBucket.arnForObjects("*")],
        principals: [new iam.ServicePrincipal("cloudfront.amazonaws.com")],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      })
    );

    const table = new dynamodb.Table(this, "ContribCache", {
      partitionKey: { name: "cacheKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const allowedOrigins = [
      `https://${domainName}`,
      `https://www.${domainName}`,
      `https://${distribution.domainName}`,
    ];
    const cacheTtl = this.node.tryGetContext("cacheTtlSeconds") || "21600";
    const shareImage = this.node.tryGetContext("shareOgImage") || `https://${distribution.domainName}/og/zerocommitsarelava.png`;
    const githubTokenSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GithubTokenSecret",
      "zero-commits-are-lava/GITHUB_TOKEN"
    );

    const contribLambda = new lambdaNode.NodejsFunction(this, "ContribLambda", {
      entry: path.join(__dirname, "../../backend/src/handlers/contrib.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        target: "node20",
      },
      environment: {
        TABLE_NAME: table.tableName,
        CACHE_TTL_SECONDS: cacheTtl,
        ALLOWED_ORIGINS: allowedOrigins.join(","),
        GITHUB_TOKEN: githubTokenSecret.secretValue.toString(),
      },
    });

    table.grantReadWriteData(contribLambda);
    githubTokenSecret.grantRead(contribLambda);

    const shareLambda = new lambdaNode.NodejsFunction(this, "ShareLambda", {
      entry: path.join(__dirname, "../../backend/src/handlers/share.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 128,
      timeout: Duration.seconds(5),
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        target: "node20",
      },
      environment: {
        FRONTEND_BASE_URL: `https://${domainName}`,
        SHARE_OG_IMAGE: shareImage,
        PUBLIC_BASE_URL: `https://${domainName}`,
      },
    });

    const shareImageLambda = new lambdaNode.NodejsFunction(this, "ShareImageLambda", {
      entry: path.join(__dirname, "../../backend/src/handlers/share-image.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 128,
      timeout: Duration.seconds(5),
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: {
        minify: true,
        target: "node20",
      },
      environment: {
        FRONTEND_BASE_URL: `https://${domainName}`,
        PUBLIC_BASE_URL: `https://${domainName}`,
      },
    });

    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowHeaders: ["content-type"],
        allowMethods: [apigwv2.CorsHttpMethod.GET],
        allowOrigins: allowedOrigins,
        maxAge: Duration.days(10),
      },
    });

    httpApi.addRoutes({
      path: "/api/contrib",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration("ContribIntegration", contribLambda),
    });

    httpApi.addRoutes({
      path: "/share",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration("ShareIntegration", shareLambda),
    });

    httpApi.addRoutes({
      path: "/share-image",
      methods: [apigwv2.HttpMethod.GET],
      integration: new apigwv2Integrations.HttpLambdaIntegration("ShareImageIntegration", shareImageLambda),
    });

    const stage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (stage) {
      stage.defaultRouteSettings = {
        throttlingBurstLimit: 50,
        throttlingRateLimit: 25,
      };
    }

    const siteSource = path.join(__dirname, "../../frontend/dist");
    new s3deploy.BucketDeployment(this, "DeploySite", {
      sources: [s3deploy.Source.asset(siteSource)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
      cacheControl: [s3deploy.CacheControl.fromString("public,max-age=0,must-revalidate")],
      prune: true,
    });

    new s3deploy.BucketDeployment(this, "DeployAssets", {
      sources: [s3deploy.Source.asset(path.join(siteSource, "assets"))],
      destinationBucket: siteBucket,
      destinationKeyPrefix: "assets",
      cacheControl: [s3deploy.CacheControl.fromString("public,max-age=31536000,immutable")],
      prune: false,
    });

    new CfnOutput(this, "CloudFrontUrl", {
      value: `https://${distribution.domainName}`,
    });

    new CfnOutput(this, "ApiBaseUrl", {
      value: httpApi.apiEndpoint,
    });

    new route53.ARecord(this, "RootAliasRecord", {
      zone: hostedZone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
    });

    new route53.AaaaRecord(this, "RootAliasRecordIpv6", {
      zone: hostedZone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
    });

    new route53.ARecord(this, "WwwAliasRecord", {
      zone: hostedZone,
      recordName: `www.${domainName}`,
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
    });

    new route53.AaaaRecord(this, "WwwAliasRecordIpv6", {
      zone: hostedZone,
      recordName: `www.${domainName}`,
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution)),
    });
  }
}
