import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';

const accessKeyId = 'VI6MRCQDN1EELYEP2NSC';
const secretAccessKey = 'jemu8SiqYm8jZsLuFoeaYHGkpwRdkac76ljOadTq';
const wasabiEndpoint = new AWS.Endpoint('s3.eu-west-1.wasabisys.com');

var AWSS3 = new AWS.S3({
  endpoint: wasabiEndpoint,
  accessKeyId: accessKeyId,
  secretAccessKey: secretAccessKey,
});

function saveMedia(data) {
  return new Promise((resolve, reject) => {
    let media_name = uuidv4();
    let params = {
      Bucket: 'confidentialcontent',
      Key: 'ticketz/' + media_name + '.png',
      Body: data,
      ContentType: 'image/png',
      ACL: 'public-read',
    };

    var options = {
      partSize: 10 * 1024 * 1024, // 10 MB
      queueSize: 10,
    };
    AWSS3.upload(params, options, function (err, data) {
      if (!err) {
        var link = data.Location;
        resolve({ success: true, link: link });
      } else {
        resolve({ success: false });
      }
    });
  });
}

export default saveMedia;
