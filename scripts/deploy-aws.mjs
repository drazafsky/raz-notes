#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const CLOUDFRONT_HOSTED_ZONE_ID = 'Z2FDTNDATAQYW2';
const DIST_DIR = resolve('dist', 'raz-notes', 'browser');

function normalizeDomain(value) {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function parseArgs(argv) {
  const options = {
    bucket: process.env.AWS_DEPLOY_BUCKET ?? '',
    distributionId: process.env.AWS_DISTRIBUTION_ID ?? '',
    distributionDomain: process.env.AWS_DISTRIBUTION_DOMAIN ?? '',
    domain: process.env.AWS_DEPLOY_DOMAIN ?? '',
    hostedZoneId: process.env.AWS_HOSTED_ZONE_ID ?? '',
    profile: process.env.AWS_PROFILE ?? '',
    region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? '',
    skipInstall: false,
    skipBuild: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const nextValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${argument}.`);
      }
      index += 1;
      return value;
    };

    switch (argument) {
      case '--bucket':
        options.bucket = nextValue();
        break;
      case '--distribution-id':
        options.distributionId = nextValue();
        break;
      case '--distribution-domain':
        options.distributionDomain = nextValue();
        break;
      case '--domain':
        options.domain = nextValue();
        break;
      case '--hosted-zone-id':
        options.hostedZoneId = nextValue();
        break;
      case '--profile':
        options.profile = nextValue();
        break;
      case '--region':
        options.region = nextValue();
        break;
      case '--skip-install':
        options.skipInstall = true;
        break;
      case '--skip-build':
        options.skipBuild = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  options.bucket = options.bucket.trim();
  options.distributionId = options.distributionId.trim();
  options.distributionDomain = options.distributionDomain
    ? normalizeDomain(options.distributionDomain)
    : '';
  options.domain = options.domain ? normalizeDomain(options.domain) : '';
  options.hostedZoneId = options.hostedZoneId.trim();
  options.profile = options.profile.trim();
  options.region = options.region.trim();

  return options;
}

function printHelp() {
  console.log(`Manual AWS deploy for raz-notes

Required:
  --domain <name>             Route 53 record name to deploy

Optional lookup overrides:
  --bucket <name>             S3 bucket that hosts the built app
  --distribution-id <id>      CloudFront distribution ID
  --distribution-domain <dns> Override the CloudFront DNS name when needed
  --hosted-zone-id <id>       Route 53 hosted zone ID that owns the domain

Optional behavior:
  --profile <name>            AWS CLI profile to use
  --region <name>             AWS region for AWS CLI commands and bucket creation
  --skip-install              Skip npm ci
  --skip-build                Skip npm run build
  --dry-run                   Print commands without executing them
  --help                      Show this help

Environment variable equivalents:
  AWS_DEPLOY_BUCKET
  AWS_DISTRIBUTION_ID
  AWS_DISTRIBUTION_DOMAIN
  AWS_DEPLOY_DOMAIN
  AWS_HOSTED_ZONE_ID
  AWS_PROFILE
  AWS_REGION
  AWS_DEFAULT_REGION
`);
}

function requireOption(name, value) {
  if (!value) {
    throw new Error(`Missing required option: ${name}`);
  }
}

function baseAwsArgs(options) {
  const args = [];
  if (options.profile) {
    args.push('--profile', options.profile);
  }
  if (options.region) {
    args.push('--region', options.region);
  }
  return args;
}

function runCommand(command, args, options) {
  const printable = [command, ...args].join(' ');
  console.log(`\n> ${printable}`);

  if (options.dryRun) {
    return '';
  }

  const result = spawnSync(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.`);
  }

  return result.stdout.trim();
}

function runCommandResult(command, args, options) {
  const printable = [command, ...args].join(' ');
  console.log(`\n> ${printable}`);

  if (options.dryRun) {
    return { status: 0, stdout: '', stderr: '' };
  }

  return spawnSync(command, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

function runAwsJson(args, options) {
  const output = runCommand('aws', [...args, '--output', 'json'], options);
  if (!output) {
    return null;
  }
  return JSON.parse(output);
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function ensureBuildOutputExists() {
  if (!existsSync(DIST_DIR)) {
    throw new Error(`Build output not found at ${DIST_DIR}.`);
  }
}

function bucketExists(options) {
  const result = runCommandResult(
    'aws',
    [...baseAwsArgs(options), 's3api', 'head-bucket', '--bucket', options.bucket],
    options,
  );
  return result.status === 0;
}

function getConfiguredRegion(options) {
  const result = runCommandResult(
    'aws',
    [...baseAwsArgs({ ...options, region: '' }), 'configure', 'get', 'region'],
    options,
  );
  if (result.status !== 0) {
    return '';
  }
  return result.stdout.trim();
}

function resolveBucketRegion(options, inferredRegion = '') {
  const region = options.region || inferredRegion || getConfiguredRegion(options);
  if (!region) {
    throw new Error(
      'Bucket creation requires --region, AWS_REGION, AWS_DEFAULT_REGION, or an AWS CLI default region.',
    );
  }
  return region;
}

function ensureBucketExists(options, inferredRegion = '') {
  if (bucketExists(options)) {
    return;
  }

  const region = resolveBucketRegion(options, inferredRegion);
  const regionArgs = options.region
    ? baseAwsArgs(options)
    : [...baseAwsArgs(options), '--region', region];
  const createBucketArgs = [...regionArgs, 's3api', 'create-bucket', '--bucket', options.bucket];

  if (region !== 'us-east-1') {
    createBucketArgs.push('--create-bucket-configuration', `LocationConstraint=${region}`);
  }

  runCommand('aws', createBucketArgs, options);
  runCommand(
    'aws',
    [...regionArgs, 's3api', 'wait', 'bucket-exists', '--bucket', options.bucket],
    options,
  );
  runCommand(
    'aws',
    [
      ...regionArgs,
      's3api',
      'put-public-access-block',
      '--bucket',
      options.bucket,
      '--public-access-block-configuration',
      'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true',
    ],
    options,
  );
}

function lookupRequiresLiveAws(options, missingName, overrideHint) {
  if (!options.dryRun) {
    return;
  }

  throw new Error(
    `Automatic lookup for ${missingName} is unavailable in --dry-run mode. Pass ${overrideHint} explicitly or run without --dry-run.`,
  );
}

function listDistributions(options) {
  const distributions = [];
  let marker = '';

  while (true) {
    const args = [...baseAwsArgs(options), 'cloudfront', 'list-distributions'];
    if (marker) {
      args.push('--marker', marker);
    }

    const response = runAwsJson(args, options);
    if (!response) {
      return null;
    }

    const list = response.DistributionList ?? {};
    distributions.push(...(list.Items ?? []));
    if (!list.IsTruncated || !list.NextMarker) {
      break;
    }
    marker = list.NextMarker;
  }

  return distributions;
}

function getDistributionDetails(options, distributionId) {
  const response = runAwsJson(
    [...baseAwsArgs(options), 'cloudfront', 'get-distribution', '--id', distributionId],
    options,
  );
  if (!response) {
    return null;
  }

  const distribution = response.Distribution;
  const config = distribution.DistributionConfig;
  return {
    id: distribution.Id,
    domainName: normalizeDomain(distribution.DomainName),
    aliases: (config.Aliases.Items ?? []).map((alias) => normalizeDomain(alias)),
    targetOriginId: config.DefaultCacheBehavior.TargetOriginId,
    origins: (config.Origins.Items ?? []).map((origin) => ({
      id: origin.Id,
      domainName: normalizeDomain(origin.DomainName),
    })),
  };
}

function findDistributionIdByAlias(options, domain) {
  const distributions = listDistributions(options);
  if (!distributions) {
    return null;
  }

  const matches = distributions.filter((distribution) =>
    (distribution.Aliases?.Items ?? []).some((alias) => normalizeDomain(alias) === domain),
  );

  if (matches.length === 0) {
    throw new Error(`No CloudFront distribution was found for ${domain}.`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple CloudFront distributions were found for ${domain}. Pass --distribution-id explicitly.`,
    );
  }

  return matches[0].Id;
}

function findDistributionIdByDomainName(options, distributionDomain) {
  const distributions = listDistributions(options);
  if (!distributions) {
    return null;
  }

  const matches = distributions.filter(
    (distribution) => normalizeDomain(distribution.DomainName) === distributionDomain,
  );

  if (matches.length === 0) {
    throw new Error(`No CloudFront distribution was found with domain ${distributionDomain}.`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple CloudFront distributions matched ${distributionDomain}. Pass --distribution-id explicitly.`,
    );
  }

  return matches[0].Id;
}

function ensureDomainAliasConfigured(distributionDetails, domain) {
  if (!distributionDetails.aliases.some((alias) => alias === domain)) {
    throw new Error(`CloudFront distribution does not include ${domain} as an alternate domain name.`);
  }
}

function extractS3BucketName(originDomainName) {
  const normalized = normalizeDomain(originDomainName);
  if (!normalized.endsWith('.amazonaws.com')) {
    return '';
  }

  const markerIndex = normalized.indexOf('.s3');
  if (markerIndex === -1) {
    return '';
  }

  return normalized.slice(0, markerIndex);
}

function extractS3Region(originDomainName) {
  const normalized = normalizeDomain(originDomainName);
  const regionMarker = '.s3.';
  const markerIndex = normalized.indexOf(regionMarker);
  if (markerIndex === -1 || !normalized.endsWith('.amazonaws.com')) {
    return '';
  }

  return normalized.slice(markerIndex + regionMarker.length, -'.amazonaws.com'.length);
}

function resolveBucketFromDistribution(options, distributionDetails) {
  if (options.bucket) {
    return { bucket: options.bucket, inferredRegion: '' };
  }

  lookupRequiresLiveAws(options, 'the deploy bucket', '--bucket');

  const preferredOrigin =
    distributionDetails.origins.find((origin) => origin.id === distributionDetails.targetOriginId) ??
    distributionDetails.origins.find((origin) => !!extractS3BucketName(origin.domainName));

  const bucket = preferredOrigin ? extractS3BucketName(preferredOrigin.domainName) : '';
  if (!bucket) {
    throw new Error(
      'Could not infer an S3 bucket from the CloudFront distribution. Pass --bucket explicitly.',
    );
  }

  return {
    bucket,
    inferredRegion: extractS3Region(preferredOrigin.domainName),
  };
}

function listHostedZones(options) {
  const response = runAwsJson([...baseAwsArgs(options), 'route53', 'list-hosted-zones'], options);
  return response?.HostedZones ?? null;
}

function resolveHostedZoneId(options, domain) {
  if (options.hostedZoneId) {
    return options.hostedZoneId;
  }

  lookupRequiresLiveAws(options, 'the hosted zone', '--hosted-zone-id');

  const hostedZones = listHostedZones(options);
  if (!hostedZones) {
    return null;
  }

  const matchingZones = hostedZones
    .filter((zone) => !zone.Config?.PrivateZone)
    .map((zone) => ({
      id: zone.Id.split('/').pop() ?? '',
      name: normalizeDomain(zone.Name),
    }))
    .filter((zone) => domain === zone.name || domain.endsWith(`.${zone.name}`))
    .sort((left, right) => right.name.length - left.name.length);

  if (matchingZones.length === 0) {
    throw new Error(`No public Route 53 hosted zone was found for ${domain}.`);
  }

  return matchingZones[0].id;
}

function resolveDistributionDetails(options) {
  if (options.distributionId && options.distributionDomain && options.bucket) {
    return {
      id: options.distributionId,
      domainName: options.distributionDomain,
      aliases: [options.domain],
      targetOriginId: '',
      origins: [],
    };
  }

  if (options.distributionId) {
    const distribution = getDistributionDetails(options, options.distributionId);
    if (!distribution) {
      return null;
    }
    return distribution;
  }

  if (options.distributionDomain) {
    lookupRequiresLiveAws(options, 'the CloudFront distribution ID', '--distribution-id');
    const distributionId = findDistributionIdByDomainName(options, options.distributionDomain);
    if (!distributionId) {
      return null;
    }
    return getDistributionDetails(options, distributionId);
  }

  lookupRequiresLiveAws(options, 'the CloudFront distribution', '--distribution-id');
  const distributionId = findDistributionIdByAlias(options, options.domain);
  if (!distributionId) {
    return null;
  }
  return getDistributionDetails(options, distributionId);
}

function buildChangeBatch(domain, distributionDomain) {
  return JSON.stringify({
    Comment: `Point ${domain} to ${distributionDomain}`,
    Changes: [
      {
        Action: 'UPSERT',
        ResourceRecordSet: {
          Name: domain,
          Type: 'A',
          AliasTarget: {
            DNSName: distributionDomain,
            HostedZoneId: CLOUDFRONT_HOSTED_ZONE_ID,
            EvaluateTargetHealth: false,
          },
        },
      },
      {
        Action: 'UPSERT',
        ResourceRecordSet: {
          Name: domain,
          Type: 'AAAA',
          AliasTarget: {
            DNSName: distributionDomain,
            HostedZoneId: CLOUDFRONT_HOSTED_ZONE_ID,
            EvaluateTargetHealth: false,
          },
        },
      },
    ],
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  requireOption('--domain', options.domain);

  const distributionDetails = resolveDistributionDetails(options);
  if (!distributionDetails) {
    throw new Error(
      'CloudFront distribution lookup did not return data. Pass --distribution-id explicitly or run without --dry-run.',
    );
  }
  ensureDomainAliasConfigured(distributionDetails, options.domain);

  const bucketResolution = resolveBucketFromDistribution(options, distributionDetails);
  const hostedZoneId = resolveHostedZoneId(options, options.domain);
  if (!hostedZoneId) {
    throw new Error(
      'Hosted zone lookup did not return data. Pass --hosted-zone-id explicitly or run without --dry-run.',
    );
  }

  const resolvedOptions = {
    ...options,
    bucket: bucketResolution.bucket,
    distributionId: distributionDetails.id,
    distributionDomain: distributionDetails.domainName,
    hostedZoneId,
  };

  console.log(`Resolved deploy settings:
  domain: ${resolvedOptions.domain}
  bucket: ${resolvedOptions.bucket}
  distributionId: ${resolvedOptions.distributionId}
  distributionDomain: ${resolvedOptions.distributionDomain}
  hostedZoneId: ${resolvedOptions.hostedZoneId}`);

  if (!resolvedOptions.skipInstall) {
    runCommand(npmCommand(), ['ci'], resolvedOptions);
  }

  if (!resolvedOptions.skipBuild) {
    runCommand(npmCommand(), ['run', 'build'], resolvedOptions);
  }

  ensureBuildOutputExists();
  ensureBucketExists(resolvedOptions, bucketResolution.inferredRegion);

  runCommand(
    'aws',
    [
      ...baseAwsArgs(resolvedOptions),
      's3',
      'sync',
      DIST_DIR,
      `s3://${resolvedOptions.bucket}`,
      '--delete',
    ],
    resolvedOptions,
  );

  runCommand(
    'aws',
    [
      ...baseAwsArgs(resolvedOptions),
      'cloudfront',
      'create-invalidation',
      '--distribution-id',
      resolvedOptions.distributionId,
      '--paths',
      '/*',
    ],
    resolvedOptions,
  );

  runCommand(
    'aws',
    [
      ...baseAwsArgs(resolvedOptions),
      'route53',
      'change-resource-record-sets',
      '--hosted-zone-id',
      resolvedOptions.hostedZoneId,
      '--change-batch',
      buildChangeBatch(resolvedOptions.domain, resolvedOptions.distributionDomain),
    ],
    resolvedOptions,
  );

  console.log(`\nDeployment complete for https://${resolvedOptions.domain}`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nDeploy failed: ${message}`);
  process.exit(1);
}
