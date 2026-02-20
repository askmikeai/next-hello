import { useState, useRef, useCallback } from 'react';
import { useGreetingVideo } from '../../hooks/useGreetingVideo';
import { uploadGreetingVideo, deleteGreetingVideo } from '../../api/client';

export default function Settings() {
  const { video, loading, error, refetch } = useGreetingVideo();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) {
      setUploadError('Please upload a video file (MP4, MOV, WebM)');
      return;
    }

    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
      setUploadError('File too large. Maximum size is 100MB.');
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const result = await uploadGreetingVideo(file);
      if (result.success) {
        await refetch();
      } else {
        setUploadError(result.error || 'Upload failed');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [refetch]);

  const handleDelete = useCallback(async () => {
    if (!confirm('Are you sure you want to delete the greeting video?')) {
      return;
    }

    try {
      const result = await deleteGreetingVideo();
      if (result.success) {
        await refetch();
      } else {
        setUploadError(result.error || 'Delete failed');
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Delete failed');
    }
  }, [refetch]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }, [handleUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = '';
  }, [handleUpload]);

  return (
    <div className="settings-page">
      <div className="panel" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-header">
          <span>Greeting Video</span>
          <span className="text-muted text-sm">
            Deepfake video sent to new contacts
          </span>
        </div>

        <div style={{ padding: '1rem' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              Loading...
            </div>
          )}

          {error && (
            <div style={{
              padding: '1rem',
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger)',
              borderRadius: '6px',
              color: 'var(--danger)',
              marginBottom: '1rem'
            }}>
              {error}
            </div>
          )}

          {uploadError && (
            <div style={{
              padding: '1rem',
              background: 'var(--danger-bg)',
              border: '1px solid var(--danger)',
              borderRadius: '6px',
              color: 'var(--danger)',
              marginBottom: '1rem'
            }}>
              {uploadError}
            </div>
          )}

          {!loading && video?.exists && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: '8px',
                padding: '1rem',
                marginBottom: '1rem'
              }}>
                <video
                  controls
                  style={{
                    width: '100%',
                    maxWidth: '400px',
                    borderRadius: '6px',
                    background: '#000'
                  }}
                >
                  <source src={video.url} type="video/mp4" />
                  Your browser does not support video playback.
                </video>
              </div>

              <div style={{
                display: 'flex',
                gap: '1rem',
                alignItems: 'center',
                flexWrap: 'wrap'
              }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                  <strong>{video.filename}</strong>
                  <span style={{ marginLeft: '1rem' }}>
                    {video.sizeBytes ? `${(video.sizeBytes / 1024 / 1024).toFixed(2)} MB` : ''}
                  </span>
                  {video.uploadedAt && (
                    <span style={{ marginLeft: '1rem' }}>
                      Uploaded: {new Date(video.uploadedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <button
                  onClick={handleDelete}
                  style={{
                    ...buttonStyle,
                    background: 'var(--danger)',
                    borderColor: 'var(--danger)',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          )}

          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '8px',
              padding: '2rem',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s',
              background: dragOver ? 'var(--bg-secondary)' : 'transparent',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />

            {uploading ? (
              <div>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Uploading...</div>
                <div style={{ color: 'var(--text-muted)' }}>Please wait</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                  {video?.exists ? 'Replace Video' : 'Upload Greeting Video'}
                </div>
                <div style={{ color: 'var(--text-muted)' }}>
                  Drag and drop a video file, or click to browse
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
                  Supports MP4, MOV, WebM (max 100MB)
                </div>
              </div>
            )}
          </div>

          <div style={{
            marginTop: '1.5rem',
            padding: '1rem',
            background: 'var(--bg-secondary)',
            borderRadius: '6px',
            fontSize: '0.875rem',
            color: 'var(--text-muted)'
          }}>
            <strong>How it works:</strong> This video will be sent as a personalized greeting
            to new contacts when they first message you. For best results, use a deepfake
            video generated with your face and voice (e.g., from SadTalker + ElevenLabs).
          </div>
        </div>
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  background: 'var(--bg-secondary)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  padding: '0.5rem 1rem',
  borderRadius: '6px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.875rem',
};
