import { URL_PRESIGNED_URL } from '@/constants';
import { PresignedUrlResponse } from '@/interfaces';
import { postAPI, postSageMakerAPI } from '@/utils/api/postApi';

// Ask the backend for a short-lived presigned POST policy for an upload.
// The client never sees long-lived AWS credentials — it only receives the
// signed fields it must echo back to S3.
export const getPresignedUrl = async ({
  filename,
  detailType,
  url,
  isPublic,
  idToken,
  details
}: {
  filename: string;
  detailType: string;
  url?: string;
  isPublic?: boolean;
  idToken?: string;
  details?: { [key: string]: string };
}) => {
  const refinedUrl = url || '';

  return (
    await postAPI({
      url: `${refinedUrl}${URL_PRESIGNED_URL}`,
      queryParams: {
        DetailType: detailType,
        Detail: {
          filename: filename,
          ...details
        }
      },
      idToken,
      isPublic
    })
  )?.data as PresignedUrlResponse;
};

export const getSagemakerPresignedUrl = async ({
  filename,
  detailType,
  url,
  idToken,
  details
}: {
  filename: string;
  detailType: string;
  url?: string;
  idToken?: string;
  details?: { [key: string]: string };
}) => {
  const refinedUrl = url || '';

  return (
    await postSageMakerAPI({
      url: `${refinedUrl}${URL_PRESIGNED_URL}`,
      queryParams: {
        DetailType: detailType,
        Detail: {
          filename: filename,
          ...details
        }
      },
      idToken
    })
  )?.data as PresignedUrlResponse;
};

// Upload a local file straight to S3 using a presigned POST policy.
// All auth lives in the signed `fields`; the file goes in last as required by S3.
// Returns the uploaded object key on success, throws on a non-2xx response.
export const uploadToS3 = async ({
  url,
  filename,
  contentType,
  presignedUrl
}: {
  url: string;
  filename: string;
  /** Actual file MIME type, e.g. 'image/jpeg' / 'video/mp4'. */
  contentType: string;
  presignedUrl: PresignedUrlResponse;
}): Promise<string> => {
  const fields = {
    key: presignedUrl.fields.key,
    'x-amz-algorithm': presignedUrl.fields['x-amz-algorithm'],
    'x-amz-credential': presignedUrl.fields['x-amz-credential'],
    'x-amz-date': presignedUrl.fields['x-amz-date'],
    'x-amz-security-token': presignedUrl.fields['x-amz-security-token'],
    'x-amz-signature': presignedUrl.fields['x-amz-signature'],
    policy: presignedUrl.fields.policy
  };
  const formData = new FormData();
  Object.entries(fields).forEach(([field, value]) => {
    formData.append(field, value);
  });
  // File must be appended LAST (S3 POST policy requirement), with its real
  // content type — not 'multipart/form-data', which would be stored as the
  // object's Content-Type metadata.
  formData.append('file', {
    uri: url,
    type: contentType,
    name: filename
  });

  // Do NOT set a Content-Type header: the runtime adds the multipart boundary
  // automatically. Setting it manually omits the boundary and breaks S3 parsing.
  const response = await fetch(presignedUrl.url, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`S3 upload failed: ${response.status} ${body}`);
  }

  return presignedUrl.fields.key;
};
