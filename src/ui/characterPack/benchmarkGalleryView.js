import { state } from '../appState.js'
import { fetchBenchmarkGallery } from './api.js'
import { renderBenchmarkGallery } from './renderers.js'

export async function refreshBenchmarkGallery() {
  state.characterPack.benchmarkGallery = {
    ...state.characterPack.benchmarkGallery,
    loading: true,
    error: null,
  }
  renderBenchmarkGallery(state.characterPack.benchmarkGallery)
  try {
    const gallery = await fetchBenchmarkGallery()
    state.characterPack.benchmarkGallery = {
      ...gallery,
      loading: false,
      error: null,
      updatedAt: new Date().toISOString(),
    }
  } catch (error) {
    state.characterPack.benchmarkGallery = {
      runs: state.characterPack.benchmarkGallery.runs ?? [],
      loading: false,
      error: error.message,
      updatedAt: new Date().toISOString(),
    }
  }
  renderBenchmarkGallery(state.characterPack.benchmarkGallery)
}
