/**
 * @license Copyright 2017 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const ByteEfficiencyAudit = require('./byte-efficiency-audit');
const Util = require('../../report/html/renderer/util');
const WebInspector = require('../../lib/web-inspector');

// Based on HTTP Archive information we go for 170kb
// More info can be found here https://github.com/GoogleChrome/lighthouse/issues/1902
const BUNDLE_SIZE_THRESHOLD = 170 * 1024;

class TotalByteWeight extends ByteEfficiencyAudit {
  /**
   * @return {!AuditMeta}
   */
  static get meta() {
    return {
      name: 'total-byte-weight',
      description: 'Avoids enormous network payloads',
      failureDescription: 'Has enormous network payloads',
      scoreDisplayMode: ByteEfficiencyAudit.SCORING_MODES.NUMERIC,
      helpText:
        'Large network payloads cost users real money and are highly correlated with ' +
        'long load times. [Learn ' +
        'more](https://developers.google.com/web/tools/lighthouse/audits/network-payloads).',
      requiredArtifacts: ['devtoolsLogs'],
    };
  }

  /**
   * @return {LH.Audit.ScoreOptions}
   */
  static get defaultOptions() {
    return {
      // see https://www.desmos.com/calculator/gpmjeykbwr
      // ~75th and ~90th percentiles http://httparchive.org/interesting.php?a=All&l=Feb%201%202017&s=All#bytesTotal
      scorePODR: 2500 * 1024,
      scoreMedian: 4000 * 1024,
    };
  }

  /**
   * Checks if record is a javascript asset and if it exceeds our bundle size limit
   *
   * @param {LH.WebInspector.NetworkRequest} record
   * @return {boolean}
   */
  static hasExceededJSBundleSize(record) {
    return record._resourceType === WebInspector.resourceTypes.Script
      && record.transferSize > BUNDLE_SIZE_THRESHOLD;
  }

  /**
   * @param {!Artifacts} artifacts
   * @param {LH.Audit.Context} context
   * @return {!Promise<!AuditResult>}
   */
  static audit(artifacts, context) {
    const devtoolsLogs = artifacts.devtoolsLogs[ByteEfficiencyAudit.DEFAULT_PASS];
    return Promise.all([
      artifacts.requestNetworkRecords(devtoolsLogs),
      artifacts.requestNetworkThroughput(devtoolsLogs),
    ]).then(([networkRecords, networkThroughput]) => {
      let totalBytes = 0;
      let results = [];
      networkRecords.forEach(record => {
        // exclude data URIs since their size is reflected in other resources
        // exclude unfinished requests since they won't have transfer size information
        if (record.scheme === 'data' || !record.finished) return;

        const result = {
          url: record.url,
          totalBytes: record.transferSize,
          totalMs: ByteEfficiencyAudit.bytesToMs(record.transferSize, networkThroughput),
          flagged: TotalByteWeight.hasExceededJSBundleSize(record),
        };

        totalBytes += result.totalBytes;
        results.push(result);
      });

      const totalCompletedRequests = results.length;
      results = results.sort((itemA, itemB) => itemB.totalBytes - itemA.totalBytes).slice(0, 10);

      const score = ByteEfficiencyAudit.computeLogNormalScore(
        totalBytes,
        context.options.scorePODR,
        context.options.scoreMedian
      );

      const headings = [
        {key: 'url', itemType: 'url', text: 'URL'},
        {
          key: 'totalBytes',
          itemType: 'bytes',
          displayUnit: 'kb',
          granularity: 1,
          text: 'Total Size',
        },
        {key: 'totalMs', itemType: 'ms', text: 'Transfer Time'},
      ];

      const tableDetails = ByteEfficiencyAudit.makeTableDetails(headings, results);

      return {
        score,
        rawValue: totalBytes,
        displayValue: `Total size was ${Util.formatBytesToKB(totalBytes, 1)}`,
        extendedInfo: {
          value: {
            results,
            totalCompletedRequests,
          },
        },
        details: tableDetails,
      };
    });
  }
}

module.exports = TotalByteWeight;
