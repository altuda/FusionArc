import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

interface FileDropzoneProps {
  onFileAccepted: (file: File) => void
  isLoading?: boolean
}

export default function FileDropzone({ onFileAccepted, isLoading }: FileDropzoneProps) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onFileAccepted(acceptedFiles[0])
    }
  }, [onFileAccepted])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/tab-separated-values': ['.tsv'],
      'text/plain': ['.txt'],
    },
    maxFiles: 1,
    disabled: isLoading,
  })

  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
        ${isDragActive
          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
          : 'border-gray-300 dark:border-gray-600 hover:border-primary-400 dark:hover:border-primary-500'
        }
        ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input {...getInputProps()} />
      <svg
        className="mx-auto h-12 w-12 text-gray-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
        />
      </svg>
      <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
        {isDragActive
          ? 'Drop the file here...'
          : 'Drag and drop a STAR-Fusion or Arriba TSV file, or click to select'
        }
      </p>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
        Supports .tsv and .txt files
      </p>
    </div>
  )
}
