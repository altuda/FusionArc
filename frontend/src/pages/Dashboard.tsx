import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Card, { CardHeader, CardBody } from '../components/common/Card'
import Button from '../components/common/Button'
import FileDropzone from '../components/common/FileDropzone'
import ManualInput from '../components/fusion/ManualInput'
import FusionTable from '../components/fusion/FusionTable'
import BatchInputModal from '../components/fusion/BatchInputModal'
import { useFusions, useCreateManualFusion, useUploadFusion } from '../hooks/useFusions'
import { FusionManualInput, createBatchFusions } from '../api/client'

type InputMode = 'manual' | 'file'

export default function Dashboard() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [inputMode, setInputMode] = useState<InputMode>('manual')
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(sessionId)

  const { data: fusionsData, isLoading: isLoadingFusions } = useFusions(currentSessionId)
  const createManualMutation = useCreateManualFusion()
  const uploadMutation = useUploadFusion()

  useEffect(() => {
    if (sessionId) {
      setCurrentSessionId(sessionId)
    }
  }, [sessionId])

  const handleManualSubmit = async (data: FusionManualInput) => {
    try {
      const result = await createManualMutation.mutateAsync(data)
      // Navigate to the fusion detail page
      navigate(`/session/${result.session_id}/fusion/${result.id}`)
    } catch (error) {
      console.error('Failed to create fusion:', error)
    }
  }

  const handleFileUpload = async (file: File) => {
    try {
      const session = await uploadMutation.mutateAsync(file)
      setCurrentSessionId(session.id)
      navigate(`/session/${session.id}`)
    } catch (error) {
      console.error('Failed to upload file:', error)
    }
  }

  const handleBatchSubmit = async (content: string) => {
    try {
      const session = await createBatchFusions(content)
      setCurrentSessionId(session.id)
      setShowBatchModal(false)
      navigate(`/session/${session.id}`)
    } catch (error) {
      console.error('Failed to create batch fusions:', error)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          Gene Fusion Visualizer
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Analyze gene fusions and visualize protein domains
        </p>
      </div>

      {/* Input Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setInputMode('manual')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors
                  ${inputMode === 'manual'
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
                  }`}
              >
                Manual Input
              </button>
              <button
                onClick={() => setInputMode('file')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors
                  ${inputMode === 'file'
                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'
                  }`}
              >
                File Upload
              </button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowBatchModal(true)}>
              Batch Input
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {inputMode === 'manual' ? (
            <ManualInput
              onSubmit={handleManualSubmit}
              isLoading={createManualMutation.isPending}
            />
          ) : (
            <FileDropzone
              onFileAccepted={handleFileUpload}
              isLoading={uploadMutation.isPending}
            />
          )}
        </CardBody>
      </Card>

      {/* Results Section */}
      {currentSessionId && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Fusion Results
                {fusionsData && (
                  <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                    ({fusionsData.total} fusions)
                  </span>
                )}
              </h2>

              {/* Legend */}
              <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                <span className="flex items-center">
                  <span className="w-2 h-2 rounded-full bg-green-500 mr-1" />
                  Positive
                </span>
                <span className="flex items-center">
                  <span className="w-2 h-2 rounded-full bg-yellow-500 mr-1" />
                  Partial
                </span>
                <span className="flex items-center">
                  <span className="w-2 h-2 rounded-full bg-red-500 mr-1" />
                  Negative
                </span>
                <span className="flex items-center">
                  <span className="w-2 h-2 rounded-full bg-gray-400 mr-1" />
                  Unknown
                </span>
              </div>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {isLoadingFusions ? (
              <div className="flex items-center justify-center py-12">
                <svg className="animate-spin h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : fusionsData && fusionsData.fusions.length > 0 ? (
              <FusionTable fusions={fusionsData.fusions} sessionId={currentSessionId} />
            ) : (
              <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                No fusions found. Enter a fusion above to get started.
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Empty state when no session */}
      {!currentSessionId && (
        <Card>
          <CardBody>
            <div className="text-center py-12">
              <svg
                className="mx-auto h-16 w-16 text-gray-300 dark:text-gray-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
                No fusions analyzed yet
              </h3>
              <p className="mt-2 text-gray-500 dark:text-gray-400">
                Enter gene names and breakpoints above, or upload a fusion caller output file.
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Batch Input Modal */}
      <BatchInputModal
        isOpen={showBatchModal}
        onClose={() => setShowBatchModal(false)}
        onSubmit={handleBatchSubmit}
      />
    </div>
  )
}
