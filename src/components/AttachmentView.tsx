// Renders a single attachment. Already handles both image and video kinds:
// video shows a "coming soon" placeholder so adding video capture later needs
// no UI change here.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { attachmentSrc } from "../lib/attachments";
import { Attachment } from "../lib/types";

interface Props {
  attachment: Attachment;
}

export default function AttachmentView({ attachment }: Props) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    void attachmentSrc(attachment).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.file_name]);

  if (attachment.kind === "video") {
    return (
      <div className="attachment video-placeholder">
        🎬 {t("attachments.videoComingSoon")}
      </div>
    );
  }

  return (
    <div className="attachment">
      {src ? (
        <img src={src} alt="attachment" loading="lazy" />
      ) : (
        <div className="img-placeholder" />
      )}
    </div>
  );
}
