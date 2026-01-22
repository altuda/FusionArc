import { useState } from 'react'
import Modal from '../common/Modal'
import Button from '../common/Button'

interface BatchInputModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (content: string) => void
  isLoading?: boolean
}

export default function BatchInputModal({ isOpen, onClose, onSubmit, isLoading }: BatchInputModalProps) {
  const [content, setContent] = useState('')

  const handleSubmit = () => {
    if (content.trim()) {
      onSubmit(content)
    }
  }

  const exampleText = `# Example format (one fusion per line):
# GENE_A chr:pos:strand GENE_B chr:pos:strand [junction_reads] [spanning_reads]

BCR chr22:23632600:+ ABL1 chr9:130854064:-
EML4 chr2:42492091:+ ALK chr2:29446394:- 50 30
NPM1 chr5:170837543:+ ALK chr2:29446394:- 25 15`

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Batch Input">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Enter multiple fusions, one per line. Format: GENE_A breakpoint GENE_B breakpoint [reads]
        </p>

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={exampleText}
          rows={10}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
        />

        <div className="flex justify-end space-x-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!content.trim() || isLoading}>
            {isLoading ? 'Processing...' : 'Analyze All'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
