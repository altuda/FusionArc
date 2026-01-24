import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Card, { CardHeader, CardBody } from '../components/common/Card'
import Button from '../components/common/Button'
import FileDropzone from '../components/common/FileDropzone'
import ManualInput from '../components/fusion/ManualInput'
import FusionTable from '../components/fusion/FusionTable'
import BatchInputModal from '../components/fusion/BatchInputModal'
import { useFusions, useCreateManualFusion, useUploadFusion } from '../hooks/useFusions'
import { FusionManualInput, createBatchFusions, createBatchFromFusions } from '../api/client'

type InputMode = 'manual' | 'file'
type SessionMode = 'new' | 'add'  // 'new' creates new session, 'add' adds to current

export default function Dashboard() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [inputMode, setInputMode] = useState<InputMode>('manual')
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [showCreateBatchModal, setShowCreateBatchModal] = useState(false)
  const [batchName, setBatchName] = useState('')
  const [isCreatingBatch, setIsCreatingBatch] = useState(false)
  const [selectedFusionIds, setSelectedFusionIds] = useState<Set<string>>(new Set())
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(sessionId)
  const [sessionMode, setSessionMode] = useState<SessionMode>('new')

  const { data: fusionsData, isLoading: isLoadingFusions } = useFusions(currentSessionId)
  const createManualMutation = useCreateManualFusion()
  const uploadMutation = useUploadFusion()

  useEffect(() => {
    if (sessionId) {
      setCurrentSessionId(sessionId)
    }
  }, [sessionId])

  // Clear selection when session changes
  useEffect(() => {
    setSelectedFusionIds(new Set())
  }, [currentSessionId])

  const handleManualSubmit = async (data: FusionManualInput) => {
    try {
      const targetSessionId = sessionMode === 'add' && currentSessionId ? currentSessionId : undefined
      const result = await createManualMutation.mutateAsync({
        input: data,
        sessionId: targetSessionId
      })
      // Update current session and navigate
      setCurrentSessionId(result.session_id)
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
      const targetSessionId = sessionMode === 'add' && currentSessionId ? currentSessionId : undefined
      const session = await createBatchFusions(content, targetSessionId)
      setCurrentSessionId(session.id)
      setShowBatchModal(false)
      navigate(`/session/${session.id}`)
    } catch (error) {
      console.error('Failed to create batch fusions:', error)
    }
  }

  const handleCreateBatchFromSelected = async () => {
    if (selectedFusionIds.size < 2) return
    setIsCreatingBatch(true)
    try {
      const session = await createBatchFromFusions(
        Array.from(selectedFusionIds),
        batchName || undefined
      )
      setShowCreateBatchModal(false)
      setBatchName('')
      setSelectedFusionIds(new Set())
      // Navigate to the batch view page to see all fusions stacked
      navigate(`/session/${session.id}/batch`)
    } catch (error) {
      console.error('Failed to create batch:', error)
    } finally {
      setIsCreatingBatch(false)
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

      {/* Session Control - only show when there's an active session */}
      {currentSessionId && (
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Session:
              </span>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="sessionMode"
                  value="new"
                  checked={sessionMode === 'new'}
                  onChange={() => setSessionMode('new')}
                  className="mr-2 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  New session
                </span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  name="sessionMode"
                  value="add"
                  checked={sessionMode === 'add'}
                  onChange={() => setSessionMode('add')}
                  className="mr-2 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Add to current
                  {fusionsData && (
                    <span className="ml-1 text-gray-500 dark:text-gray-400">
                      ({fusionsData.total} fusion{fusionsData.total !== 1 ? 's' : ''})
                    </span>
                  )}
                </span>
              </label>
            </div>
            {sessionMode === 'add' && (
              <span className="text-xs text-primary-600 dark:text-primary-400">
                New fusions will be added to the current session
              </span>
            )}
          </div>
        </div>
      )}

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
              sessionId={sessionMode === 'add' ? currentSessionId : undefined}
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
              <div className="flex items-center space-x-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Fusion Results
                  {fusionsData && (
                    <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                      ({fusionsData.total} fusions)
                    </span>
                  )}
                </h2>
                {selectedFusionIds.size > 0 && (
                  <span className="text-sm text-primary-600 dark:text-primary-400">
                    {selectedFusionIds.size} selected
                  </span>
                )}
                {selectedFusionIds.size >= 2 && (
                  <Button
                    size="sm"
                    onClick={() => setShowCreateBatchModal(true)}
                  >
                    Create Batch
                  </Button>
                )}
              </div>

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
              <FusionTable
                fusions={fusionsData.fusions}
                sessionId={currentSessionId}
                selectable={true}
                selectedIds={selectedFusionIds}
                onSelectionChange={setSelectedFusionIds}
              />
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

      {/* Create Batch from Selected Modal */}
      {showCreateBatchModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-black/50 transition-opacity"
              onClick={() => setShowCreateBatchModal(false)}
            />
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Create Batch
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Create a new batch with {selectedFusionIds.size} selected fusions.
                The original fusions will remain in their current sessions.
              </p>
              <div className="mb-4">
                <label
                  htmlFor="batch-name"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Batch Name (optional)
                </label>
                <input
                  type="text"
                  id="batch-name"
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  placeholder={`Batch (${selectedFusionIds.size} fusions)`}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                    bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                    focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div className="flex justify-end space-x-3">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowCreateBatchModal(false)
                    setBatchName('')
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateBatchFromSelected}
                  disabled={isCreatingBatch}
                >
                  {isCreatingBatch ? 'Creating...' : 'Create Batch'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
