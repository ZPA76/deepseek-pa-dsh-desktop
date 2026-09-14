'use strict'

const path = require('node:path')
const { verifyRelease } = require('./release-integrity')

function verifyStaging(root = path.resolve(__dirname, '..')) {
  const resolvedRoot = path.resolve(root)
  return verifyRelease(resolvedRoot, path.join(resolvedRoot, 'dist-staging'))
}

if (require.main === module) {
  const result = verifyStaging()
  console.log('DPA staging package verified:', result.version, Object.keys(result.files).length, 'files', result.archiveSha256)
}

module.exports = { verifyStaging }
