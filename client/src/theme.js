import { createTheme } from '@mui/material/styles'

// NexDigi dark theme. The app is dark-mode only by design (no light variant
// or toggle), so every surface color is defined explicitly here rather than
// relying on individual components to opt into dark styling themselves.
const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#5b9bff',
      light: '#8ac2ff',
      dark: '#2f6fd1',
      contrastText: '#0a0e14'
    },
    secondary: {
      main: '#00c9a7'
    },
    background: {
      default: '#0d1117',
      paper: '#161b22'
    },
    text: {
      primary: '#e6edf3',
      secondary: '#9aa7b5'
    },
    divider: 'rgba(230, 237, 243, 0.12)',
    success: { main: '#3fb950' },
    warning: { main: '#d29922' },
    error: { main: '#f85149' },
    info: { main: '#5b9bff' }
  },
  shape: {
    borderRadius: 10
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { fontWeight: 600, textTransform: 'none' }
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#0d1117',
          colorScheme: 'dark'
        },
        // Some pages render raw HTML checkboxes/labels outside MUI components
        'input[type="checkbox"]': {
          accentColor: '#5b9bff'
        }
      }
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#161b22',
          backgroundImage: 'none',
          borderBottom: '1px solid rgba(230, 237, 243, 0.08)'
        }
      }
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none'
        }
      },
      defaultProps: {
        elevation: 0
      }
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(230, 237, 243, 0.08)'
        }
      },
      defaultProps: {
        elevation: 0
      }
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundImage: 'none',
          backgroundColor: '#161b22',
          border: '1px solid rgba(230, 237, 243, 0.08)'
        }
      }
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8
        }
      }
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500
        }
      }
    },
    MuiOutlinedInput: {
      styleOverrides: {
        notchedOutline: {
          borderColor: 'rgba(230, 237, 243, 0.18)'
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: 'rgba(230, 237, 243, 0.08)'
        }
      }
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: 'rgba(230, 237, 243, 0.12)'
        }
      }
    }
  }
})

export default theme
