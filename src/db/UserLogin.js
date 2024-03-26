import mongoose from 'mongoose';

const loginSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    email: {
      type: String,
      required: true,
    },
    token: {
      type: String,
      required: true,
    },
  },

  {
    timestamps: true,
  }
);

const LoginModel = mongoose.model('Login', loginSchema);

export default LoginModel;
